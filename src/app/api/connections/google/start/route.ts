import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAccess } from "@/lib/auth/access";
import { buildGoogleAuthUrl } from "@/lib/connections/google-oauth";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/connections/state-cookie";
import { supabaseCookieOptions } from "@/lib/supabase/cookies";

// Starts the Gmail/Calendar connection from Settings. Only an active
// member may start it; the redirect_uri is fixed to this route's own
// callback (never taken from the request), matching exactly what must be
// registered in the Google Cloud OAuth client.
export async function GET(request: Request) {
  const access = await getAccess();
  if (access.status !== "member") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/connections/google/callback`;
  const state = randomUUID();

  let authUrl: string;
  try {
    authUrl = buildGoogleAuthUrl({ redirectUri, state });
  } catch {
    return NextResponse.redirect(new URL("/settings?connect=not_configured#settings-connections", url.origin));
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    ...supabaseCookieOptions,
    httpOnly: true,
    maxAge: 600,
  });
  return response;
}
