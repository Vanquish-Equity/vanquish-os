import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {requireMachineToken} from "@/lib/sync/machine-token";
import {verifyGmailPush} from "@/lib/sync/push-auth";
export async function POST(request:Request){
  const audience=process.env.GMAIL_PUSH_AUDIENCE,account=process.env.GMAIL_PUSH_SERVICE_ACCOUNT;
  const pushJwt=process.env.GMAIL_PUSH_JWT;
  if(!audience||!account||!pushJwt)return NextResponse.json({error:"Push is not configured"},{status:503});
  try { requireMachineToken(pushJwt,"vanquish_gmail_push"); } catch { return NextResponse.json({error:"Push credential requires rotation"},{status:503}); }
  const token=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]??"";
  if(!await verifyGmailPush(token,audience,account))return NextResponse.json({error:"Unauthorized"},{status:401});
  let signal:{emailAddress:string;historyId:string};
  try{
    const text=await request.text();if(text.length>20000)throw new Error();
    const body=JSON.parse(text) as {message?:{data?:string}};
    if(!body.message?.data||body.message.data.length>4096)throw new Error();
    signal=JSON.parse(Buffer.from(body.message.data,"base64").toString("utf8"));
    if(typeof signal.emailAddress!=="string"||signal.emailAddress.length>254||typeof signal.historyId!=="string"||!/^\d{1,40}$/.test(signal.historyId))throw new Error();
  }catch{return NextResponse.json({error:"Invalid signal"},{status:400});}
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)return NextResponse.json({error:"Push is not configured"},{status:503});
  const db=createClient(url,key,{global:{headers:{Authorization:`Bearer ${pushJwt}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await db.rpc("worker_signal_gmail",{p_address:signal.emailAddress,p_history_id:signal.historyId});
  return error?NextResponse.json({error:"Queue unavailable"},{status:503}):new NextResponse(null,{status:204});
}
