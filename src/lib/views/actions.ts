"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError, getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import type { PeopleViewFilters, ViewObjectType } from "./queries";
import type { PipelineViewFilters } from "./pipeline-queries";

export type ViewActionResult = { ok: true } | { ok: false; message: string };

const REVALIDATE_PATH: Record<ViewObjectType, string> = {
  people: "/people",
  pipeline: "/pipeline",
};

export async function saveViewAction(input: {
  objectType: ViewObjectType;
  name: string;
  isShared: boolean;
  filters: PeopleViewFilters | PipelineViewFilters;
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
    object_type: input.objectType,
    name,
    owner: access.email,
    is_shared: input.isShared,
    filters: input.filters,
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

  revalidatePath(REVALIDATE_PATH[input.objectType]);
  return { ok: true };
}

export async function deleteViewAction(
  id: string,
  objectType: ViewObjectType,
): Promise<ViewActionResult> {
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

  revalidatePath(REVALIDATE_PATH[objectType]);
  return { ok: true };
}
