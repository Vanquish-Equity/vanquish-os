"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; message?: string } | { ok: false; message: string };

async function relationshipRpc(name: string, args?: Record<string, unknown>): Promise<Result> {
  if ((await getAccess()).status !== "member") return { ok: false, message: "Sign in to continue." };
  const { error } = await (await createClient()).rpc(name, args);
  if (error) return { ok: false, message: "Could not update relationship history. Check Google connection and sync consent." };
  revalidatePath("/settings");
  revalidatePath("/integrations");
  revalidatePath("/people");
  return { ok: true };
}

export async function setRelationshipSync(enabled: boolean): Promise<Result> {
  if (typeof enabled !== "boolean") return { ok: false, message: "Invalid consent." };
  const result = await relationshipRpc("configure_relationship_sync", { p_enabled: enabled });
  return result.ok ? { ok: true, message: enabled ? "Relationship sync enabled and queued for the external worker." : "Sync turned off. Existing history stays until you delete it." } : result;
}

export async function syncRelationshipsNow(): Promise<Result> {
  const access = await getAccess();
  if (access.status !== "member") return { ok: false, message: "Sign in to continue." };
  const db = await createClient();
  const { data, error } = await db.from("relationship_sync").select("enabled").eq("member_email", access.email).maybeSingle();
  if (error || !data?.enabled) return { ok: false, message: "Turn relationship history on first." };
  const result = await relationshipRpc("request_crm_sync");
  return result.ok ? { ok: true, message: "Run queued for the external worker; no mailbox is read by this browser." } : result;
}

export async function deleteMyRelationshipHistory(): Promise<Result> {
  const result = await relationshipRpc("delete_my_relationship_history");
  return result.ok ? { ok: true, message: "Your history was deleted and relationship sync is off. CRM sync remains independent." } : result;
}
