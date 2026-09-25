import { createServerClient } from "@supabase/ssr";
import { supabaseCookieOptions } from "@/lib/supabase/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "@/lib/auth/redirect";

// Routes reachable without a session. Everything else requires one; the
// dashboard layout then checks membership and area permissions, and RLS
// enforces the same rules in the database.
function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/auth/");
}

function withSessionCookies(target: NextResponse, source: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: supabaseCookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims verifies the JWT (and refreshes an expiring session) instead
  // of trusting the cookie contents.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    // Server actions and other non-GET calls get a plain 401 instead of a
    // redirect they cannot follow.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSessionCookies(
        NextResponse.json({ error: "Sign in required" }, { status: 401 }),
        response
      );
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const next = safeNextPath(`${pathname}${search}`);
    if (next !== DEFAULT_AFTER_LOGIN || pathname === DEFAULT_AFTER_LOGIN) {
      loginUrl.searchParams.set("next", next);
    }
    return withSessionCookies(NextResponse.redirect(loginUrl), response);
  }

  if (signedIn && pathname === "/login") {
    // safeNextPath only returns same-origin paths.
    const target = new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.url);
    return withSessionCookies(NextResponse.redirect(target), response);
  }

  return response;
}
