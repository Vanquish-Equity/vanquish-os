"use server";

import { logActivity } from "@/lib/activity/log";
import { revalidatePath } from "next/cache";
import { actionAccessError, getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { cleanFounderProfile } from "./founder-profile";
import { csvRows } from "@/lib/reporting/csv";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MISSING_SCHEMA = new Set(["42703", "PGRST204"]);

export async function saveFounderProfile(personId: string, fields: unknown) {
  const denied = await actionAccessError();
  if (denied) return { ok: false as const, message: denied };
  const profile = cleanFounderProfile(fields);
  if (!UUID.test(personId) || !profile) return { ok: false as const, message: "Enter a valid contact and keep City and Country within 120 characters, Origin within 160." };
  const db = await createClient();
  const { data, error } = await db.from("people").update(profile)
    .eq("id", personId).is("archived_at", null).select("id").maybeSingle();
  if (error || !data) return {
    ok: false as const,
    message: MISSING_SCHEMA.has(error?.code ?? "") ? "Location and origin need the database update." : "Location and origin could not be saved.",
  };
  await logActivity({ eventType: "PERSON_UPDATED", targetType: "person", targetId: personId,
    payload: { fields: ["city", "country", "origin"] } }, db);
  revalidatePath("/people");
  revalidatePath(`/people/${personId}`);
  return { ok: true as const };
}

// Export only the explicitly shown IDs, re-read now under the caller's RLS.
// No email, mailbox evidence, contact notes, files, or private board fields.
export async function exportShownPeople(ids: unknown) {
  const denied = await actionAccessError();
  if (denied) return { ok: false as const, message: denied };
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 ||
      ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
      new Set(ids.map((id) => id.toLowerCase())).size !== ids.length) {
    return { ok: false as const, message: "Export up to 1,000 different contacts shown in this view." };
  }
  const identity = await getAccess();
  if (identity.status !== "member") return { ok: false as const, message: "Sign in as an active member to export." };
  const db = await createClient();
  const rows: { id: string; name: string; title: string | null; city: string | null; country: string | null; origin: string | null }[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    // Each batch repeats the server membership check and RLS re-evaluates
    // active membership and machine isolation for the actual SELECT.
    const { data: member, error: membershipError } = await db.from("app_members")
      .select("email").eq("email", identity.email).eq("is_active", true).maybeSingle();
    if (membershipError || !member) return { ok: false as const, message: "Export unavailable. Membership changed." };
    const { data, error } = await db.from("people").select("id,name,title,city,country,origin")
      .in("id", ids.slice(offset, offset + 100)).is("archived_at", null).order("id").limit(100);
    if (error || !data) return { ok: false as const, message: "Export unavailable. Check current access and the database update." };
    rows.push(...data);
  }
  return { ok: true as const, csv: "\uFEFF" + csvRows([
    ["scope", "shown active contacts only", "timezone", "UTC", "currency", "N/A", "row cap", 1000],
    ["consistency", "Concurrent export; not a snapshot", "rows", rows.length],
    ["id", "name", "title", "city", "country", "origin"],
    ...rows.map(({ id, name, title, city, country, origin }) => [id, name, title, city, country, origin]),
  ]) };
}
