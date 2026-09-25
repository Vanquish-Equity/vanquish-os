import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST only, so a link or image cannot sign someone out.
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?signed_out=1", request.url), { status: 303 });
}
