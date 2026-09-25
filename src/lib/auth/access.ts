import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  can,
  toPermissionSet,
  type AccessState,
  type AreaPermission,
} from "@/lib/auth/permissions";

// Resolves who is signed in and what they may use, once per request.
// Identity comes from the verified JWT (getClaims); membership and
// permissions come from tables whose RLS only returns the caller's rows.
export const getAccess = cache(async (): Promise<AccessState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) return { status: "anonymous" };

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
  if (!email) return { status: "unauthorized", email: null };

  const [{ data: member }, { data: permissionRows }] = await Promise.all([
    supabase
      .from("app_members")
      .select("email,is_active")
      .eq("email", email)
      .maybeSingle(),
    supabase.from("member_permissions").select("permission").eq("email", email),
  ]);

  if (!member?.is_active) return { status: "unauthorized", email };

  return {
    status: "member",
    email,
    permissions: toPermissionSet((permissionRows ?? []).map((row) => row.permission)),
  };
});

// For pages: sends visitors to /login and signed-in non-members to
// /access-denied.
export async function requireMember() {
  const access = await getAccess();
  if (access.status === "anonymous") redirect("/login");
  if (access.status === "unauthorized") redirect("/access-denied");
  return access;
}

export async function hasPermission(permission: AreaPermission) {
  return can(await getAccess(), permission);
}

// For server actions: a result message instead of a redirect. RLS enforces
// the same rules in the database; this keeps the failure explicit.
export async function actionAccessError(permission?: AreaPermission) {
  const access = await getAccess();
  if (access.status === "anonymous") return "Sign in to continue.";
  if (access.status === "unauthorized") return "This account is not authorized for Vanquish OS.";
  if (permission && !access.permissions.has(permission)) {
    return "You do not have access to this area.";
  }
  return null;
}
