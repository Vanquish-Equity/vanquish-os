import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAccess } from "@/lib/auth/access";
import { encryptToken } from "@/lib/connections/crypto";
import { exchangeGoogleCode } from "@/lib/connections/google-oauth";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/connections/state-cookie";
import { createClient } from "@/lib/supabase/server";

// Google sends the member back here after they approve (or decline) the
// Gmail/Calendar connection. Exchanges the code for tokens, encrypts the
// refresh token (src/lib/connections/crypto.ts) and stores it through
// save_mailbox_connection — a function scoped to the signed-in member's own
// row (migration 20260929200000) — then sends them back to Settings.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const settingsUrl = (status: string) => new URL(`/settings?connect=${status}#settings-connections`, url.origin);

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(settingsUrl("declined"));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const cookieState = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  const clearStateCookie = (response: NextResponse) => {
    response.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE);
    return response;
  };

  if (!code || !state || !cookieState || state !== cookieState) {
    return clearStateCookie(NextResponse.redirect(settingsUrl("error")));
  }

  const access = await getAccess();
  if (access.status !== "member") {
    return clearStateCookie(NextResponse.redirect(new URL("/login", url.origin)));
  }

  try {
    const redirectUri = `${url.origin}/api/connections/google/callback`;
    const tokens = await exchangeGoogleCode(code, redirectUri);
    if (!tokens.refresh_token) {
      // Google omits refresh_token when this exact grant already exists
      // without prompt=consent; we always pass prompt=consent, so this
      // should not happen in practice, but never overwrite a working
      // connection with one that can't be refreshed.
      return clearStateCookie(NextResponse.redirect(settingsUrl("no_refresh_token")));
    }

    const { encrypted, iv, tag } = encryptToken(tokens.refresh_token);
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_mailbox_connection", {
      p_granted_scopes: tokens.scope.split(" ").filter(Boolean),
      p_refresh_token_encrypted: encrypted,
      p_refresh_token_iv: iv,
      p_refresh_token_tag: tag,
    });
    if (error) {
      return clearStateCookie(NextResponse.redirect(settingsUrl("error")));
    }
  } catch {
    return clearStateCookie(NextResponse.redirect(settingsUrl("error")));
  }

  return clearStateCookie(NextResponse.redirect(settingsUrl("ok")));
}
