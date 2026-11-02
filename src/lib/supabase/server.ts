import { createServerClient } from "@supabase/ssr";
import { supabaseCookieOptions } from "@/lib/supabase/cookies";
import { cookies } from "next/headers";
import { perfEnvEnabled } from "@/lib/perf/config";
import { instrumentFetch } from "@/lib/perf/fetch";
import { supabaseLabel } from "@/lib/perf/labels";
import { perfCollector } from "@/lib/perf/request";

export async function createClient() {
  const cookieStore = await cookies();
  // Only when VQ_PERF_PANEL=1 and the request is being measured; otherwise
  // the client is built exactly as before, with no custom fetch.
  const collector = perfEnvEnabled() ? await perfCollector() : null;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: supabaseCookieOptions,
      ...(collector ? { global: { fetch: instrumentFetch(collector, supabaseLabel) } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session instead, so this can be safely ignored.
          }
        },
      },
    }
  );
}
