"use server";

import { revalidatePath } from "next/cache";
import { getAccess, hasPermission } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { createTaskAction, setTaskStatusAction } from "@/lib/tasks/actions";

type Result = { ok: true; url?: string } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fileName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}_[\w. -]{1,140}$/;
const invalid = { ok: false, message: "This contact or action is unavailable." } as const;

function done(): Result {
  revalidatePath("/people");
  return { ok: true };
}

export async function saveContactNote(personId: string, body: string): Promise<Result> {
  if (!uuid.test(personId) || typeof body !== "string" || !body.trim() || body.trim().length > 2000) return invalid;
  const db = await createClient();
  const { error } = await db.from("contact_notes").insert({ person_id: personId, body: body.trim() });
  return error ? { ok: false, message: "Couldn't save the note." } : done();
}

export async function removeContactNote(personId: string, noteId: string): Promise<Result> {
  if (!uuid.test(personId) || !uuid.test(noteId)) return invalid;
  const db = await createClient();
  const { count, error } = await db.from("contact_notes").delete({ count: "exact" }).eq("id", noteId).eq("person_id", personId);
  return error || count !== 1 ? { ok: false, message: "Couldn't remove the note." } : done();
}

export async function createContactReminder(personId: string, title: string, dueAt: string): Promise<Result> {
  const access = await getAccess();
  if (access.status !== "member" || !uuid.test(personId) || typeof title !== "string" || !title.trim() || title.trim().length > 160 ||
    typeof dueAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) return invalid;
  const date = new Date(dueAt);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== dueAt || dueAt.startsWith("0000")) return invalid;
  const result = await createTaskAction({ title, dueAt, personId, owner: "", assigneeEmail: access.email,
    companyId: null, dealId: null, priorityId: null });
  return result.ok ? done() : { ok: false, message: "Couldn't create the reminder." };
}

export async function completeContactReminder(personId: string, taskId: string): Promise<Result> {
  const access = await getAccess();
  if (access.status !== "member" || !uuid.test(personId) || !uuid.test(taskId)) return invalid;
  const db = await createClient();
  const { data } = await db.from("tasks").select("id").eq("id", taskId).eq("person_id", personId)
    .eq("assignee_email", access.email).eq("status", "open").is("archived_at", null).maybeSingle();
  if (!data) return invalid;
  const result = await setTaskStatusAction({ taskId, status: "done", companyId: null });
  return result.ok ? done() : { ok: false, message: "Couldn't complete the reminder." };
}

export async function uploadContactFile(personId: string, form: FormData): Promise<Result> {
  if (!uuid.test(personId) || !(await hasPermission("documents"))) return invalid;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > 3 * 1024 * 1024)
    return { ok: false, message: "Choose a file up to 3 MB." };
  const name = file.name.replace(/[^a-zA-Z0-9_. -]/g, "_").trim().slice(0, 140) || "file";
  const db = await createClient();
  const { error } = await db.storage.from("contact-files").upload(`${personId}/${crypto.randomUUID()}_${name}`, file,
    { contentType: "application/octet-stream", upsert: false });
  return error ? { ok: false, message: "Couldn't upload the file." } : done();
}

export async function downloadContactFile(personId: string, name: string): Promise<Result> {
  if (!uuid.test(personId) || !fileName.test(name) || !(await hasPermission("documents"))) return invalid;
  const db = await createClient();
  const { data, error } = await db.storage.from("contact-files").createSignedUrl(`${personId}/${name}`, 60, { download: name.slice(37) });
  return error || !data ? { ok: false, message: "Couldn't open the file." } : { ok: true, url: data.signedUrl };
}

export async function removeContactFile(personId: string, name: string): Promise<Result> {
  if (!uuid.test(personId) || !fileName.test(name) || !(await hasPermission("documents"))) return invalid;
  const db = await createClient();
  const { data, error } = await db.storage.from("contact-files").remove([`${personId}/${name}`]);
  return error || data?.length !== 1 ? { ok: false, message: "Couldn't remove the file." } : done();
}
