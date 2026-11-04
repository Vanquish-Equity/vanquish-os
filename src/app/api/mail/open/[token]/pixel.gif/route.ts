import { createClient } from "@supabase/supabase-js";
import { mailOpenDigest, mailOpenOrigin } from "@/lib/google/mail-open-signal";

const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const headers = { "Content-Type": "image/gif", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (mailOpenOrigin() && /^[a-f0-9]{64}$/.test(token)) {
    try {
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await db.rpc("record_mail_open_signal", { p_digest: mailOpenDigest(token) }).abortSignal(AbortSignal.timeout(1500));
    } catch { /* Never reveal whether a token exists. */ }
  }
  return new Response(new Uint8Array(pixel), { headers });
}

export function HEAD() {
  return new Response(null, { headers });
}
