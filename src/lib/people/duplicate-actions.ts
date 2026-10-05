"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { actionAccessError, getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

export type DuplicateActionResult = { ok: true } | { ok: false; message: string };

const UUID = /^[0-9a-f-]{36}$/i;

export async function mergePeopleAction(keepId: string, dropId: string): Promise<DuplicateActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  if (!UUID.test(keepId) || !UUID.test(dropId) || keepId === dropId) {
    return { ok: false, message: "Choose two different people to merge." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_people", { p_keep: keepId, p_drop: dropId });
  if (error) {
    return {
      ok: false,
      message:
        error.code === "42501"
          ? "This person has investor positions; only a member with Portfolio access can merge them."
          : "Could not merge these people. Refresh and try again.",
    };
  }
  const access = await getAccess();
  await logActivity(
    {
      eventType: "PEOPLE_MERGED",
      targetType: "person",
      targetId: keepId,
      payload: { mergedPersonId: dropId },
      actor: access.status === "member" ? access.email : "anonymous",
    },
    supabase,
  );
  revalidatePath("/people", "layout");
  return { ok: true };
}

export async function dismissDuplicateAction(aId: string, bId: string): Promise<DuplicateActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  if (!UUID.test(aId) || !UUID.test(bId) || aId === bId) {
    return { ok: false, message: "Invalid pair." };
  }
  const access = await getAccess();
  if (access.status !== "member") return { ok: false, message: "Sign in to continue." };
  const [low, high] = aId < bId ? [aId, bId] : [bId, aId];
  const supabase = await createClient();
  const { error } = await supabase
    .from("person_duplicate_dismissals")
    .insert({ person_low: low, person_high: high, dismissed_by: access.email });
  if (error && error.code !== "23505") return { ok: false, message: "Could not save that." };
  revalidatePath("/people/duplicates");
  return { ok: true };
}
