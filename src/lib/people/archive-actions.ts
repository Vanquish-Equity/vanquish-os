"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { validPeopleSelection } from "./bulk-selection";

export async function changeArchivedPeople(ids: string[], operation: "restore" | "delete") {
  const access = await getAccess();
  if (access.status !== "member" || !validPeopleSelection(ids) ||
      (operation !== "restore" && operation !== "delete") ||
      (operation === "delete" && !access.permissions.has("admin"))) {
    return { ok: false as const, message: "This action is unavailable." };
  }
  const db = await createClient();
  const query = operation === "delete"
    ? db.from("people").delete({ count: "exact" })
    : db.from("people").update({ archived_at: null, updated_at: new Date().toISOString() }, { count: "exact" });
  const { count, error } = await query.in("id", ids).not("archived_at", "is", null);
  if (error || !count) return { ok: false as const, message: error?.code === "23503"
    ? "A selected contact is still linked to a record that prevents deletion. No contacts were deleted."
    : "No contacts were changed. Check access and refresh." };
  revalidatePath("/people", "layout");
  revalidatePath("/companies", "layout");
  revalidatePath("/communications", "layout");
  return { ok: true as const, count };
}
