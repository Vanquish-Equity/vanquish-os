"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

export type StageRuleInput = {
  stageId: string;
  title: string;
  dueInDays: number | null;
  assigneeEmail: string | null;
};

// RLS only lets admins write stage_task_rules; this check keeps the
// failure explicit instead of a silent no-op.
async function adminSession() {
  const access = await getAccess();
  if (access.status !== "member" || !access.permissions.has("admin")) return null;
  return { email: access.email, supabase: await createClient() };
}

export async function createStageRule(input: StageRuleInput): Promise<Result> {
  const session = await adminSession();
  if (!session) return { ok: false, message: "Admin access required." };
  const title = input.title.trim();
  if (!input.stageId || !title || title.length > 200) {
    return { ok: false, message: "Choose a stage and a task title under 200 characters." };
  }
  if (input.dueInDays !== null && (!Number.isInteger(input.dueInDays) || input.dueInDays < 0 || input.dueInDays > 365)) {
    return { ok: false, message: "Due in days must be a whole number from 0 to 365." };
  }
  const { error } = await session.supabase.from("stage_task_rules").insert({
    stage_id: input.stageId,
    title,
    due_in_days: input.dueInDays,
    assignee_email: input.assigneeEmail || null,
    created_by: session.email,
  });
  if (error) return { ok: false, message: "Could not save the rule." };
  revalidatePath("/settings");
  return { ok: true };
}

export async function setStageRuleActive(id: string, active: boolean): Promise<Result> {
  const session = await adminSession();
  if (!session) return { ok: false, message: "Admin access required." };
  const { data, error } = await session.supabase
    .from("stage_task_rules")
    .update({ is_active: active })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { ok: false, message: "Could not update the rule." };
  revalidatePath("/settings");
  return { ok: true };
}
