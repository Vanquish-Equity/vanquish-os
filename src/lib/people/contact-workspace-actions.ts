"use server";

import { revalidatePath } from "next/cache";
import { getAccess, hasPermission } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { audienceProblem, parseVisibility, sanitizeRecipients } from "@/lib/people/contact-privacy";

type Result = { ok: true; url?: string } | { ok: false; message: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fileName = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}_[\w. -]{1,140}$/;
const invalid = { ok: false, message: "This contact or action is unavailable." } as const;

function done(): Result {
  revalidatePath("/people");
  return { ok: true };
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function audience(visibility: unknown, recipients: unknown) {
  const access = await getAccess();
  const mode = parseVisibility(visibility ?? "team");
  if (access.status !== "member" || !mode) return null;
  const list = sanitizeRecipients(recipients, access.email, mode);
  const problem = audienceProblem(mode, list);
  return { email: access.email, mode, list, problem };
}

// Replaces the included members of one item (creator only, enforced by RLS).
// Returns false when any step failed.
async function syncRecipients(db: Db, table: "contact_note_recipients" | "contact_reminder_recipients", key: "note_id" | "reminder_id",
  id: string, wanted: string[]): Promise<boolean> {
  const current = await db.from(table).select("member_email").eq(key, id).limit(50);
  if (current.error) return false;
  const have = new Set((current.data ?? []).map((row) => row.member_email as string));
  const drop = [...have].filter((email) => !wanted.includes(email));
  const add = wanted.filter((email) => !have.has(email));
  if (drop.length) {
    const removed = await db.from(table).delete().eq(key, id).in("member_email", drop);
    if (removed.error) return false;
  }
  if (add.length) {
    const added = await db.from(table).insert(add.map((member_email) => ({ [key]: id, member_email })));
    if (added.error) return false;
  }
  return true;
}

export async function saveContactNote(personId: string, body: string, visibility: string = "team", recipients: string[] = []): Promise<Result> {
  if (!uuid.test(personId) || typeof body !== "string" || !body.trim() || body.trim().length > 2000) return invalid;
  const who = await audience(visibility, recipients);
  if (!who) return invalid;
  if (who.problem) return { ok: false, message: who.problem };
  const db = await createClient();
  const { data, error } = await db.from("contact_notes").insert({ person_id: personId, body: body.trim(), visibility: who.mode })
    .select("id").single();
  if (error || !data) return { ok: false, message: "Couldn't save the note." };
  if (who.list.length && !(await syncRecipients(db, "contact_note_recipients", "note_id", data.id, who.list))) {
    await db.from("contact_notes").delete().eq("id", data.id);
    return { ok: false, message: "Couldn't save the note." };
  }
  return done();
}

export async function removeContactNote(personId: string, noteId: string): Promise<Result> {
  if (!uuid.test(personId) || !uuid.test(noteId)) return invalid;
  const db = await createClient();
  const { count, error } = await db.from("contact_notes").delete({ count: "exact" }).eq("id", noteId).eq("person_id", personId);
  return error || count !== 1 ? { ok: false, message: "Couldn't remove the note." } : done();
}

function validDue(dueAt: unknown): dueAt is string {
  if (typeof dueAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt) || dueAt.startsWith("0000")) return false;
  const date = new Date(dueAt);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === dueAt;
}

export async function createContactReminder(personId: string, title: string, dueAt: string,
  visibility: string = "team", recipients: string[] = []): Promise<Result> {
  if (!uuid.test(personId) || typeof title !== "string" || !title.trim() || title.trim().length > 160 || !validDue(dueAt)) return invalid;
  const who = await audience(visibility, recipients);
  if (!who) return invalid;
  if (who.problem) return { ok: false, message: who.problem };
  const db = await createClient();
  const { data, error } = await db.from("contact_reminders")
    .insert({ person_id: personId, title: title.trim(), due_on: dueAt, visibility: who.mode }).select("id").single();
  if (error || !data) return { ok: false, message: "Couldn't create the reminder." };
  if (who.list.length && !(await syncRecipients(db, "contact_reminder_recipients", "reminder_id", data.id, who.list))) {
    await db.from("contact_reminders").delete().eq("id", data.id);
    return { ok: false, message: "Couldn't create the reminder." };
  }
  return done();
}

// Creator only (RLS). Changes title, due date, visibility and who is included.
export async function updateContactReminder(personId: string, reminderId: string, title: string, dueAt: string,
  visibility: string, recipients: string[]): Promise<Result> {
  if (!uuid.test(personId) || !uuid.test(reminderId) || typeof title !== "string" || !title.trim() || title.trim().length > 160 || !validDue(dueAt)) return invalid;
  const who = await audience(visibility, recipients);
  if (!who) return invalid;
  if (who.problem) return { ok: false, message: who.problem };
  const db = await createClient();
  const { data, error } = await db.from("contact_reminders").update({ title: title.trim(), due_on: dueAt, visibility: who.mode })
    .eq("id", reminderId).eq("person_id", personId).eq("created_by", who.email).select("id");
  if (error || data?.length !== 1) return { ok: false, message: "Couldn't update the reminder." };
  return (await syncRecipients(db, "contact_reminder_recipients", "reminder_id", reminderId, who.list))
    ? done() : { ok: false, message: "Couldn't update who is included." };
}

export async function removeContactReminder(personId: string, reminderId: string): Promise<Result> {
  if (!uuid.test(personId) || !uuid.test(reminderId)) return invalid;
  const db = await createClient();
  const { count, error } = await db.from("contact_reminders").delete({ count: "exact" }).eq("id", reminderId).eq("person_id", personId);
  return error || count !== 1 ? { ok: false, message: "Couldn't remove the reminder." } : done();
}

// One shared reminder, done for everyone. The database function refuses
// anyone who is not the creator or an included member, and a second completion.
export async function completeContactReminder(personId: string, reminderId: string): Promise<Result> {
  const access = await getAccess();
  if (access.status !== "member" || !uuid.test(personId) || !uuid.test(reminderId)) return invalid;
  const db = await createClient();
  const { error } = await db.rpc("complete_contact_reminder", { p_id: reminderId });
  if (!error) return done();
  if (error.code === "55000") return { ok: false, message: "This reminder is already done." };
  return { ok: false, message: "Couldn't complete the reminder." };
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
