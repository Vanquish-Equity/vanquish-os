"use server";
import { revalidatePath } from "next/cache";
import { getAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { googleClient,googleResult,requireScope,resourceId,attachmentResourceId } from "@/lib/google/client";
import { activeDealInCompanyError } from "@/lib/deals/guards";
import { analyzeDocument } from "./analyze";
import { formatCanonicalDocumentName } from "./naming";
import { formatMessage } from "@/lib/google/mail-format";
import type { GmailMessage } from "@/lib/google/mail-types";

type Target={companyId:string;dealId:string|null};
async function documentAccess(target?:Target) {
  const access=await getAccess();
  if(access.status!=="member"||!access.permissions.has("documents"))throw new Error("Documents access required.");
  const db=await createClient();
  if(target){const {data}=await db.from("companies").select("id").eq("id",target.companyId).is("deleted_at",null).maybeSingle();if(!data||target.dealId&&await activeDealInCompanyError(db,target.dealId,target.companyId))throw new Error("Target unavailable.");}
  return {db,access};
}
export async function inspectDriveFile(fileId:string) {
  return googleResult(async()=>{await documentAccess();const client=await googleClient();requireScope(client,"drive.readonly","drive.file","drive");
    return client.request<{id:string;name:string;mimeType:string;size?:string;modifiedTime:string;version?:string;parents?:string[];webViewLink?:string;trashed?:boolean}>("drive",`/files/${resourceId(fileId)}?fields=id,name,mimeType,size,modifiedTime,version,parents,webViewLink,trashed&supportsAllDrives=true`);
  });
}
export async function listDriveFolder(folderId:string,pageToken?:string) {
  return googleResult(async()=>{await documentAccess();const client=await googleClient();requireScope(client,"drive.readonly","drive.file","drive");resourceId(folderId);
    const params=new URLSearchParams({q:`'${folderId}' in parents and trashed=false`,pageSize:"100",fields:"files(id,name,mimeType,size,modifiedTime),nextPageToken",supportsAllDrives:"true",includeItemsFromAllDrives:"true"});if(pageToken)params.set("pageToken",pageToken);
    return client.request<{files:{id:string;name:string;mimeType:string;size?:string;modifiedTime:string}[];nextPageToken?:string}>("drive",`/files?${params}`);
  });
}
export async function importDriveFile(fileId:string,target:Target) {
  return googleResult(async()=>{
    const {db,access}=await documentAccess(target);const info=await inspectDriveFile(fileId);if(!info.ok||info.data.trashed)throw new Error("File unavailable.");
    const file=info.data;if(file.mimeType==="application/vnd.google-apps.folder")throw new Error("Choose a file.");
    const {data,error}=await db.from("documents").insert({company_id:target.companyId,deal_id:target.dealId,name:file.name,source:"drive_link",drive_file_id:file.id,drive_revision:file.version??file.modifiedTime,drive_url:`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,content_type:file.mimeType,size_bytes:file.size?Number(file.size):null,uploaded_by:access.email,entity_role:"TARGET"}).select("id").single();
    if(error||!data)throw new Error("File already imported or unavailable.");
    let bytes:Uint8Array=new Uint8Array();let mime=file.mimeType;const client=await googleClient();
    try{
      if(file.mimeType==="application/vnd.google-apps.document"){mime="text/plain";bytes=await client.request<Uint8Array>("drive",`/files/${resourceId(file.id)}/export?mimeType=text%2Fplain`,{responseType:"bytes"});}
      else if(!file.size||Number(file.size)<=4*1024*1024)bytes=await client.request<Uint8Array>("drive",`/files/${resourceId(file.id)}?alt=media&supportsAllDrives=true`,{responseType:"bytes"});
    }catch{/* Link remains usable; extraction is explicitly marked for review. */}
    const analyzed=await analyzeDocument(db,data.id,file.name,bytes,mime);
    revalidatePath("/documents");revalidatePath(`/companies/${target.companyId}`);
    return {id:data.id,analyzed};
  });
}
export async function importMailAttachment(input:Target&{messageId:string;attachmentId:string;name:string;mime:string}) {
  return googleResult(async()=>{
    const {db,access}=await documentAccess(input);const client=await googleClient();requireScope(client,"gmail.readonly","gmail.modify","mail.google.com");
    const source=await client.request<GmailMessage>("gmail",`/messages/${resourceId(input.messageId)}?format=full`);
    const attachment=formatMessage(source).attachments.find(file=>file.id===input.attachmentId);
    if(!attachment)throw new Error("Attachment is no longer available.");
    input={...input,name:attachment.name,mime:attachment.mimeType};
    // IDs are caller-owned Google resources; no arbitrary URL is fetched.
    const content=await client.request<{data:string;size:number}>("gmail",`/messages/${resourceId(input.messageId)}/attachments/${attachmentResourceId(input.attachmentId)}`);
    if(content.size>4*1024*1024)throw new Error("Attachment exceeds 4 MB.");
    const bytes=Buffer.from(content.data,"base64url");if(bytes.length>4*1024*1024||!input.name||input.name.length>500)throw new Error("Invalid attachment.");
    const path=`${input.companyId}/${crypto.randomUUID()}-${input.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-140)}`;
    const {error:uploadError}=await db.storage.from("documents").upload(path,bytes,{contentType:input.mime||"application/octet-stream",upsert:false});if(uploadError)throw new Error("Attachment could not be saved.");
    const {data,error}=await db.from("documents").insert({company_id:input.companyId,deal_id:input.dealId,name:input.name,storage_path:path,source:"upload",content_type:input.mime,size_bytes:bytes.length,uploaded_by:access.email,entity_role:"TARGET"}).select("id").single();
    if(error||!data){await db.storage.from("documents").remove([path]);throw new Error("Attachment could not be registered.");}
    const analyzed=await analyzeDocument(db,data.id,input.name,bytes,input.mime);
    revalidatePath("/documents");revalidatePath(`/companies/${input.companyId}`);return {id:data.id,analyzed};
  });
}
export async function loadDocumentTargets() {
  try {
    const {db}=await documentAccess();
    const [companies,deals]=await Promise.all([db.from("companies").select("id,name").is("deleted_at",null).order("name").limit(1000),db.from("deals").select("id,name,company_id").is("archived_at",null).order("name").limit(1000)]);
    return [...(companies.data??[]).map(c=>({companyId:c.id,dealId:null,label:c.name})),...(deals.data??[]).map(d=>({companyId:d.company_id,dealId:d.id,label:`Round: ${d.name}`}))];
  }catch{return null;}
}
export async function monitorDriveFolder(folder:string,target:Target,enabled=true) {
  try {
    const {db}=await documentAccess(target);
    if(enabled){const client=await googleClient();requireScope(client,"drive.readonly","drive.file","drive");const folderInfo=await client.request<{mimeType:string;trashed?:boolean}>("drive",`/files/${resourceId(folder)}?fields=mimeType,trashed&supportsAllDrives=true`);if(folderInfo.trashed||folderInfo.mimeType!=="application/vnd.google-apps.folder")throw new Error("Folder unavailable.");}
    const {error}=await db.rpc("configure_drive_source",{p_folder:folder,p_company:target.companyId,p_deal:target.dealId,p_enabled:enabled});
    revalidatePath("/documents");return {ok:!error,message:error?"Could not configure folder monitoring.":enabled?"Folder monitoring enabled and queued for the worker.":"Folder monitoring paused."};
  }catch{return {ok:false,message:"Documents access and a valid destination are required."};}
}
export async function reviewDocument(id:string,typeId:string,date:string|null,revision:number,dismiss=false) {
  const {db}=await documentAccess();
  const [document,type]=await Promise.all([db.from("documents").select("name,entity_role,doc_status,version_number,company:companies(name)").eq("id",id).maybeSingle(),db.from("document_types").select("name,category:document_categories(code)").eq("id",typeId).maybeSingle()]);
  if(!document.data||!dismiss&&!type.data)return {ok:false,message:"Document unavailable."};
  const d=document.data,t=type.data;
  const name=t?formatCanonicalDocumentName({entityRole:d.entity_role??"TARGET",entityName:(d.company as unknown as {name:string}|null)?.name??"Unknown",category:(t.category as unknown as {code:string}|null)?.code??"OTHER",documentType:t.name,extension:d.name.split(".").pop()??"pdf",documentDate:date,docStatus:d.doc_status??"RECEIVED",versionNumber:d.version_number}):d.name;
  const {data,error}=await db.rpc("decide_document_analysis",{p_id:id,p_revision:revision,p_type:typeId||null,p_date:date,p_name:name,p_dismiss:dismiss});
  revalidatePath("/documents");revalidatePath("/companies","layout");return {ok:!error,message:error?"Could not apply document metadata.":data==="conflict"?"Document metadata changed. Refresh and reprocess before applying.":`Document review ${data}.`};
}
export async function organizeDriveDocument(id:string,folderId?:string) {
  return googleResult(async()=>{
    const {db}=await documentAccess();const {data:d}=await db.from("documents").select("name,drive_file_id,drive_revision").eq("id",id).is("archived_at",null).maybeSingle();if(!d?.drive_file_id)throw new Error("Drive document unavailable.");
    const client=await googleClient();requireScope(client,"drive","drive.file");
    const info=await inspectDriveFile(d.drive_file_id);if(!info.ok)throw new Error("File unavailable.");
    if(d.drive_revision && d.drive_revision !== (info.data.version??info.data.modifiedTime))throw new Error("File changed in Drive. Refresh its metadata before renaming or moving it.");
    const params=new URLSearchParams({supportsAllDrives:"true",fields:"id,name,parents"});
    if(folderId){resourceId(folderId);params.set("addParents",folderId);if(info.data.parents?.length)params.set("removeParents",info.data.parents.filter(parent=>parent!==folderId).join(","));}
    return client.request<{id:string;name:string}>("drive",`/files/${resourceId(d.drive_file_id)}?${params}`,{method:"PATCH",headers:{"If-Match":"*"},body:JSON.stringify({name:d.name})});
  });
}
export async function reprocessDocument(id:string) {
  return googleResult(async()=>{
    const {db}=await documentAccess();
    const {data:d}=await db.from("documents").select("name,storage_path,drive_file_id,content_type").eq("id",id).is("archived_at",null).maybeSingle();
    if(!d)throw new Error("Document unavailable.");
    let bytes:Uint8Array;let mime=d.content_type??"application/octet-stream";
    if(d.storage_path){const {data,error}=await db.storage.from("documents").download(d.storage_path);if(error||!data)throw new Error("File unavailable.");bytes=new Uint8Array(await data.arrayBuffer());}
    else if(d.drive_file_id){const client=await googleClient();requireScope(client,"drive.readonly","drive.file","drive");if(mime==="application/vnd.google-apps.document"){mime="text/plain";bytes=await client.request("drive",`/files/${resourceId(d.drive_file_id)}/export?mimeType=text%2Fplain`,{responseType:"bytes"});}else bytes=await client.request("drive",`/files/${resourceId(d.drive_file_id)}?alt=media&supportsAllDrives=true`,{responseType:"bytes"});}
    else throw new Error("No processable file is linked.");
    const {error}=await db.rpc("reopen_document_analysis",{p_id:id});if(error)throw new Error("Analysis is unavailable.");
    if(!await analyzeDocument(db,id,d.name,bytes,mime))throw new Error("Analysis could not be registered.");revalidatePath("/documents");return {id};
  });
}
