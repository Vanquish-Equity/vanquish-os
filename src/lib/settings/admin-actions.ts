"use server";

import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; message: string };

async function adminClient() {
  const access = await getAccess();
  if (access.status !== "member" || !access.permissions.has("admin")) return null;
  return createClient();
}

export async function setMemberActive(email: string, active: boolean): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, message: "Admin access required." };
  const { error } = await supabase.rpc("admin_set_member_active", { p_email: email, p_active: active });
  if (error) return { ok: false, message: "Could not update this member." };
  revalidatePath("/settings");
  return { ok: true };
}

export async function setMemberPermission(
  email: string,
  permission: "portfolio" | "documents" | "email_scouting",
  enabled: boolean
): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, message: "Admin access required." };
  const { error } = await supabase.rpc("admin_set_member_permission", { p_email: email, p_permission: permission, p_enabled: enabled });
  if (error) return { ok: false, message: "Could not update this permission." };
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveIgnoredDomain(domain: string, reason: string): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, message: "Admin access required." };
  const value = domain.trim().toLowerCase();
  if (value.length > 253 || !/^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$/.test(value) || reason.length > 200) {
    return { ok: false, message: "Enter a valid domain and a reason under 200 characters." };
  }
  const { error } = await supabase.rpc("admin_save_ignored_domain", { p_domain: value, p_reason: reason });
  if (error) return { ok: false, message: "Could not save the domain." };
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteIgnoredDomain(domain: string): Promise<Result> {
  const supabase = await adminClient();
  if (!supabase) return { ok: false, message: "Admin access required." };
  const { error } = await supabase.rpc("admin_delete_ignored_domain", { p_domain: domain });
  if (error) return { ok: false, message: "Could not remove the domain." };
  revalidatePath("/settings");
  return { ok: true };
}
