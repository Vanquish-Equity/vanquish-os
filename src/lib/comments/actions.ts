"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { actionAccessError, getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

// Comment writes go through the database functions (0019), which check the
// member and the record. Comment text is never echoed in errors or logs.

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type CommentTaskInput = { title: string; assignee: string | null; due: string | null };

function commentError(error: { code?: string; message?: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "42501") return "You cannot change this comment.";
  if (error.code === "42883" || error.code === "PGRST202") return "Comments are not available yet (database migration 0019 pending).";
  if ((error.code === "22023" || error.code === "23514") && error.message) {
    // Our own validation messages (no user content in them).
    return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  }
  return fallback;
}

function revalidateRecord(companyId: string, dealId: string | null) {
  revalidatePath(`/companies/${companyId}`);
  if (dealId) revalidatePath(`/companies/${companyId}/deals/${dealId}`);
}

function cleanTask(task: CommentTaskInput | null | undefined) {
  if (!task) return null;
  const title = String(task.title ?? "").trim();
  const due = String(task.due ?? "").trim();
  return {
    title,
    assignee: task.assignee ? String(task.assignee) : null,
    due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
  };
}

async function logTask(taskId: string, title: string, companyId: string, dealId: string | null) {
  const access = await getAccess();
  await logActivity({
    eventType: "TASK_CREATED",
    targetType: "task",
    targetId: taskId,
    payload: { title, companyId, dealId, source: "comment" },
    actor: access.status === "member" ? access.email : "anonymous",
  });
  revalidatePath("/tasks");
  revalidatePath("/home");
}

export async function postCommentAction(input: {
  companyId: string;
  dealId: string | null;
  parentId: string | null;
  body: string;
  mentions: string[];
  task?: CommentTaskInput | null;
}): Promise<Result<{ commentId: string; taskId: string | null }>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const body = String(input.body ?? "");
  if (!body.trim()) return { ok: false, message: "Write a comment first." };
  if (body.length > 4000) return { ok: false, message: "Comments are limited to 4000 characters." };
  const task = cleanTask(input.task);
  if (task && !task.title) return { ok: false, message: "The task needs a title." };

  const companyId = String(input.companyId ?? "");
  const dealId = input.dealId ? String(input.dealId) : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comment_post", {
    p_company: companyId,
    p_deal: dealId,
    p_parent: input.parentId ? String(input.parentId) : null,
    p_body: body,
    p_mentions: Array.isArray(input.mentions) ? input.mentions.map(String) : [],
    p_task: task,
  });
  if (error || !data) return { ok: false, message: commentError(error, "The comment could not be posted.") };
  const result = data as { comment_id: string; task_id: string | null };
  if (result.task_id && task) await logTask(result.task_id, task.title, companyId, dealId);
  revalidateRecord(companyId, dealId);
  return { ok: true, commentId: result.comment_id, taskId: result.task_id };
}

export async function editCommentAction(input: {
  commentId: string;
  companyId: string;
  dealId: string | null;
  body: string;
  mentions: string[];
}): Promise<Result> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const body = String(input.body ?? "");
  if (!body.trim()) return { ok: false, message: "A comment cannot be empty. Delete it instead." };
  if (body.length > 4000) return { ok: false, message: "Comments are limited to 4000 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("comment_edit", {
    p_comment: String(input.commentId ?? ""),
    p_body: body,
    p_mentions: Array.isArray(input.mentions) ? input.mentions.map(String) : [],
  });
  if (error) return { ok: false, message: commentError(error, "The comment could not be saved.") };
  revalidateRecord(String(input.companyId ?? ""), input.dealId ? String(input.dealId) : null);
  revalidatePath("/notifications");
  return { ok: true };
}

export async function deleteCommentAction(input: { commentId: string; companyId: string; dealId: string | null }): Promise<Result> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const supabase = await createClient();
  const { error } = await supabase.rpc("comment_delete", { p_comment: String(input.commentId ?? "") });
  if (error) return { ok: false, message: commentError(error, "The comment could not be deleted.") };
  revalidateRecord(String(input.companyId ?? ""), input.dealId ? String(input.dealId) : null);
  revalidatePath("/notifications");
  return { ok: true };
}

export async function createTaskFromCommentAction(input: {
  commentId: string;
  companyId: string;
  dealId: string | null;
  task: CommentTaskInput;
}): Promise<Result<{ taskId: string }>> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  const task = cleanTask(input.task);
  if (!task?.title) return { ok: false, message: "The task needs a title." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comment_create_task", {
    p_comment: String(input.commentId ?? ""),
    p_title: task.title,
    p_assignee: task.assignee,
    p_due: task.due,
  });
  if (error || !data) return { ok: false, message: commentError(error, "The task could not be created.") };
  const companyId = String(input.companyId ?? "");
  const dealId = input.dealId ? String(input.dealId) : null;
  await logTask(data as string, task.title, companyId, dealId);
  revalidateRecord(companyId, dealId);
  return { ok: true, taskId: data as string };
}
