"use server";

import { revalidatePath } from "next/cache";
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

  await supabase.from("activity_events").insert({
    event_type: "TASK_CREATED",
    target_type: "task",
    target_id: data.id,
    payload: { title },
    actor: cleanText(input.owner) || "system",
  });

  revalidateTaskPaths(input.companyId);
  return { ok: true, taskId: data.id };
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

  if (input.status === "done") {
    await supabase.from("activity_events").insert({
      event_type: "TASK_COMPLETED",
      target_type: "task",
      target_id: taskId,
      payload: {},
      actor: "system",
    });
  }

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
    .delete({ count: "exact" })
    .eq("id", taskId);

  if (error) return { ok: false, message: error.message };
  if (count === 0) {
    return {
      ok: false,
      message:
        "Delete was blocked by database write policy. Apply the latest migration and try again.",
    };
  }

  revalidateTaskPaths(input.companyId);
  return { ok: true };
}
