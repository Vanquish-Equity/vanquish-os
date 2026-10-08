import type {createClient} from "../supabase/server";
import { extractDocument } from "./extract";
import { classifyDocument } from "./classify";
export async function analyzeDocument(db:Awaited<ReturnType<typeof createClient>>,id:string,name:string,bytes:Uint8Array,mime:string) {
  const [extraction,types,version]=await Promise.all([
    extractDocument(bytes,mime),db.from("document_types").select("id,name,code,category_id").eq("is_active",true),
    db.from("document_versions").select("revision").eq("document_id",id).order("revision",{ascending:false}).limit(1).maybeSingle(),
  ]);
  const result=classifyDocument(name,extraction.text,types.data??[]);
  const {error}=await db.from("document_analysis").insert({document_id:id,expected_revision:version.data?.revision??1,
    extracted_text:extraction.text,extraction_status:extraction.status,suggested_type_id:result.typeId,suggested_date:result.date,confidence:result.confidence});
  return !error;
}
