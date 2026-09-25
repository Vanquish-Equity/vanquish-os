import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

// Supabase sends users here after Google (or an email link). The code is
// exchanged for a session cookie; membership is checked by the dashboard.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (url.searchParams.get("error") || !code) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth_failed", origin));
  }

  return NextResponse.redirect(new URL(next, origin));
}
