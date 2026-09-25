"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { createClient } from "@/lib/supabase/server";

export type TaskActionResult =
  | { ok: true; taskId?: string }
  | { ok: false; message: string };

function cleanText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function revalidateTaskPaths(companyId?: string | null) {
  revalidatePath("/tasks");
  revalidatePath("/overview");
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

export type CreateTaskInput = {
  title: string;
  companyId: string | null;
  dealId: string | null;
  owner: string;
  dueAt: string | null;
  priorityId: string | null;
};

export async function createTaskAction(
  input: CreateTaskInput
): Promise<TaskActionResult> {
  const title = cleanText(input.title);
  if (!title) return { ok: false, message: "Title is required." };

  const supabase = await createClient();

  if (input.dealId) {
    if (!input.companyId) return { ok: false, message: "Choose the deal's company." };
    const { data: deal } = await supabase.from("deals").select("company_id")
      .eq("id", input.dealId).is("archived_at", null).maybeSingle();
    if (!deal || deal.company_id !== input.companyId) {
      return { ok: false, message: "Choose a deal belonging to this company." };
    }
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      company_id: input.companyId || null,
      deal_id: input.dealId || null,
      owner: cleanText(input.owner) || null,
      due_at: input.dueAt || null,
      priority_id: input.priorityId || null,
      status: "open",
    })
    .select("id")
    .single();

  if (error) return { ok: false, message: error.message };
  if (!data) return { ok: false, message: "Task could not be created." };

  await logActivity(
    {
      eventType: "TASK_CREATED",
      targetType: "task",
      targetId: data.id,
      payload: { title, companyId: input.companyId, dealId: input.dealId },
      actor: cleanText(input.owner) || "anonymous",
    },
    supabase
  );

  revalidateTaskPaths(input.companyId);
  return { ok: true, taskId: data.id };
}

export async function updateTaskAction(input: {
  taskId: string;
  title: string;
  owner: string;
  dueAt: string | null;
  priorityId: string | null;
}): Promise<TaskActionResult> {
  const taskId = cleanText(input.taskId);
  const title = cleanText(input.title);
  if (!taskId || !title) return { ok: false, message: "Title is required." };
  if (input.dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueAt)) {
    return { ok: false, message: "Choose a valid due date." };
  }
  const supabase = await createClient();
  const { data: previous, error: lookupError } = await supabase
    .from("tasks")
    .select("company_id,deal_id,title,owner,due_at,priority_id")
    .eq("id", taskId).is("archived_at", null).maybeSingle();
  if (lookupError) return { ok: false, message: lookupError.message };
  if (!previous) return { ok: false, message: "Task not found." };

  const changes = {
    title,
    owner: cleanText(input.owner) || null,
    due_at: input.dueAt || null,
    priority_id: input.priorityId || null,
  };
  const { count, error } = await supabase.from("tasks")
    .update(changes, { count: "exact" }).eq("id", taskId).is("archived_at", null);
  if (error) return { ok: false, message: error.message };
  if (!count) return { ok: false, message: "Task could not be updated." };

  await logActivity({
    eventType: "TASK_UPDATED", targetType: "task", targetId: taskId,
    payload: { before: previous, after: changes, companyId: previous.company_id, dealId: previous.deal_id },
    actor: "anonymous",
  }, supabase);
  revalidateTaskPaths(previous.company_id);
  return { ok: true };
}

export async function setTaskStatusAction(input: {
  taskId: string;
  status: "open" | "done";
  companyId: string | null;
}): Promise<TaskActionResult> {
  const taskId = cleanText(input.taskId);
  if (!taskId) return { ok: false, message: "Missing task." };

  const supabase = await createClient();

  const { count, error } = await supabase
    .from("tasks")
    .update({ status: input.status }, { count: "exact" })
    .eq("id", taskId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Update was blocked by database write policy. Apply the latest migration and try again.",
    };
  }

  await logActivity(
    {
      eventType: input.status === "done" ? "TASK_COMPLETED" : "TASK_REOPENED",
      targetType: "task",
      targetId: taskId,
      payload: { companyId: input.companyId },
      actor: "anonymous",
    },
    supabase
  );

  revalidateTaskPaths(input.companyId);
  return { ok: true };
}

export async function deleteTaskAction(input: {
  taskId: string;
  companyId: string | null;
}): Promise<TaskActionResult> {
  const taskId = cleanText(input.taskId);
  if (!taskId) return { ok: false, message: "Missing task." };

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("tasks")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", taskId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Archive was blocked by database write policy. Apply the latest migration and try again.",
    };
  }

  await logActivity(
    {
      eventType: "TASK_ARCHIVED",
      targetType: "task",
      targetId: taskId,
      payload: { companyId: input.companyId },
      actor: "anonymous",
    },
    supabase
  );

  revalidateTaskPaths(input.companyId);
  return { ok: true };
}
