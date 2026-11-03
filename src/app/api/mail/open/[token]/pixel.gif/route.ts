import { createClient } from "@/lib/supabase/server";
import { mailTrackingOrigin, suspectedAutomatedOpen, trackingHash } from "@/lib/google/mail-open-tracking";

const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const response = () => new Response(new Uint8Array(pixel), {
  headers: { "Content-Type": "image/gif", "Cache-Control": "private, no-store, max-age=0" },
});

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (mailTrackingOrigin() && /^[a-zA-Z0-9_-]{43}$/.test(token)) {
    try {
      const db = await createClient();
      await db.rpc("record_mail_open_signal", {
        p_hash: trackingHash(token),
        p_automated: suspectedAutomatedOpen(request.headers.get("user-agent") ?? ""),
      });
    } catch {
      // Return the same pixel even if tracking is unavailable.
    }
  }
  return response();
}
