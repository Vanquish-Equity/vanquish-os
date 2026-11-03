"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { validPeopleSelection } from "./bulk-selection";

type Result = { ok: true; count: number } | { ok: false; message: string };

export async function bulkPeopleAction(input: {
  ids: string[];
  action: "group" | "archive";
  groupId?: string;
}): Promise<Result> {
  const denied = await actionAccessError();
  if (denied) return { ok: false, message: denied };
  if (!validPeopleSelection(input?.ids) || !["group", "archive"].includes(input.action)) {
    return { ok: false, message: "Choose between 1 and 100 contacts." };
  }

  const db = await createClient();
  let count: number;
  if (input.action === "group") {
    const groupId = input.groupId;
    if (!groupId || !validPeopleSelection([groupId])) return { ok: false, message: "Choose a group." };
    const { data: group } = await db.from("person_groups").select("id")
      .eq("id", groupId).eq("kind", "custom").maybeSingle();
    if (!group) return { ok: false, message: "That group is no longer available." };
    const { data: people, error: peopleError } = await db.from("people").select("id")
      .in("id", input.ids).is("archived_at", null);
    if (peopleError || people?.length !== input.ids.length) {
      return { ok: false, message: "Some contacts are no longer available. Refresh People and try again." };
    }
    const { error } = await db.from("person_group_members")
      .upsert(people.map(({ id }) => ({ group_id: groupId, person_id: id })), {
        onConflict: "group_id,person_id", ignoreDuplicates: true,
      });
    if (error) return { ok: false, message: "Could not add contacts to the group." };
    count = people.length;
  } else {
    const now = new Date().toISOString();
    const result = await db.from("people").update({ archived_at: now, updated_at: now }, { count: "exact" })
      .in("id", input.ids).is("archived_at", null);
    if (result.error || result.count === null) return { ok: false, message: "Could not archive contacts." };
    count = result.count;
  }
  revalidatePath("/people", "layout");
  revalidatePath("/companies", "layout");
  revalidatePath("/communications", "layout");
  return { ok: true, count };
}
