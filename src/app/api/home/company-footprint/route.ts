import { getAccess } from "@/lib/auth/access";
import { loadCompanyFootprint } from "@/lib/home/company-footprint-data";
import { createClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const access = await getAccess();
  if (access.status !== "member") {
    return new Response(null, { status: access.status === "anonymous" ? 401 : 403, headers });
  }
  const footprint = await loadCompanyFootprint(await createClient());
  return footprint ? Response.json(footprint, { headers }) : new Response(null, { status: 503, headers });
}
