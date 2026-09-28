"use server";

import { revalidatePath } from "next/cache";
import { actionAccessError } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function setDealAssigneeAction(dealId: string, email: string, assigned: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const access = await actionAccessError(); if (access) return { ok: false, message: access };
  if (!uuid.test(dealId) || !email.includes("@") || typeof assigned !== "boolean") return { ok: false, message: "Invalid assignee." };
  const db = await createClient();
  const { error } = await db.rpc("set_deal_assignee", { p_deal: dealId, p_email: email.toLowerCase().trim(), p_assigned: assigned });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/pipeline");
  revalidatePath("/boards", "layout");
  return { ok: true };
}
