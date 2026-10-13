import {NextResponse} from "next/server";
// Polling only. Do not parse payloads, verify OIDC or call Supabase while disabled.
export async function POST(){
 return NextResponse.json({error:"Gmail push is disabled; use polling."},{status:503});
}
