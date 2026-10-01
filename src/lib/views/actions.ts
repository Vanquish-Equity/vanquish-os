"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError, getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import type { PeopleViewFilters } from "./queries";

export type ViewActionResult = { ok: true } | { ok: false; message: string };

export async function saveViewAction(input: {
  name: string;
  isShared: boolean;
  filters: PeopleViewFilters;
}): Promise<ViewActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };

  const name = input.name.trim();
  if (!name || name.length > 80) {
    return { ok: false, message: "Name a view between 1 and 80 characters." };
  }

  const access = await getAccess();
  if (access.status !== "member" || !access.email) {
    return { ok: false, message: "Sign in to continue." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("saved_views").insert({
    object_type: "people",
    name,
    owner: access.email,
    is_shared: input.isShared,
    filters: {
      view: input.filters.view,
      groupId: input.filters.groupId,
      q: input.filters.q,
    },
  });

  if (error) {
    return {
      ok: false,
      message:
        error.code === "23505"
          ? "You already have a view with that name."
          : "Could not save this view.",
    };
  }

  revalidatePath("/people");
  return { ok: true };
}

export async function deleteViewAction(id: string): Promise<ViewActionResult> {
  const accessError = await actionAccessError();
  if (accessError) return { ok: false, message: accessError };
  if (typeof id !== "string" || !id) {
    return { ok: false, message: "Invalid view." };
  }

  const supabase = await createClient();
  // RLS restricts deletion to the view's owner; a non-owner delete affects
  // zero rows rather than erroring, so there's nothing further to check here.
  const { error } = await supabase.from("saved_views").delete().eq("id", id);
  if (error) return { ok: false, message: "Could not remove this view." };

  revalidatePath("/people");
  return { ok: true };
}
