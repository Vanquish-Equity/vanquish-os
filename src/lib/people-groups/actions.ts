"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError, requireMember } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; id?: string } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message: string): Result => ({ ok: false, message });
const refresh = () => { revalidatePath("/people"); revalidatePath("/communications", "layout"); };

export async function createPeopleGroup(name: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!name.trim() || name.length > 80) return fail("Enter a group name.");
  const member = await requireMember(); const db = await createClient();
  const { data, error } = await db.from("person_groups").insert({ name: name.trim(), created_by: member.email }).select("id").single();
  if (error || !data) return fail(error?.code === "23505" ? "A group with that name already exists." : "Could not create group.");
  refresh(); return { ok: true, id: data.id };
}

export async function renamePeopleGroup(id: string, name: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(id) || !name.trim() || name.length > 80) return fail("Invalid group name.");
  const db = await createClient();
  const { data, error } = await db.from("person_groups").update({ name: name.trim() }).eq("id", id).select("id").maybeSingle();
  if (error || !data) return fail(error?.code === "23505" ? "A group with that name already exists." : "Could not rename group.");
  refresh(); return { ok: true };
}

export async function deletePeopleGroup(id: string): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(id)) return fail("Invalid group.");
  const db = await createClient();
  const { data, error } = await db.from("person_groups").delete().eq("id", id).select("id").maybeSingle();
  if (error || !data) return fail("Could not delete group.");
  refresh(); return { ok: true };
}

export async function savePeopleGroupMembers(id: string, personIds: string[]): Promise<Result> {
  const access = await actionAccessError(); if (access) return fail(access);
  if (!uuid.test(id) || !Array.isArray(personIds) || personIds.length > 5000 || personIds.some((personId) => !uuid.test(personId)) || new Set(personIds).size !== personIds.length) return fail("Invalid people selection.");
  const db = await createClient();
  const { error } = await db.rpc("set_person_group_members", { p_group: id, p_people: personIds });
  if (error) return fail("Could not save group members. Reload People and try again.");
  refresh(); return { ok: true };
}
