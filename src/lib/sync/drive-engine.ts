import {GoogleError,type GoogleClient} from "../google/transport";
import {extractDocument} from "../documents/extract";
import {classifyDocument} from "../documents/classify";
export type DriveCursor={changeToken?:string;pageToken?:string;baseline?:string;knownIds?:string[];seenIds?:string[];mode?:"full"|"changes";pendingRemoved?:string[];finishToken?:string};
type DriveFile={id:string;name:string;mimeType:string;size?:string;version?:string;modifiedTime?:string;parents?:string[];trashed?:boolean};
export type DriveContext={source:{folder_id:string;company_id:string;deal_id:string|null};types:{id:string;category_id:string;name:string;code:string}[]};
export async function driveBatch(client:GoogleClient,context:DriveContext,input:DriveCursor){
  const cursor={...input};const folder=context.source.folder_id;
  if(!/^[A-Za-z0-9_-]{1,250}$/.test(folder))throw new Error("Invalid folder.");
  const known=new Set(cursor.knownIds??[]),seen=new Set(cursor.seenIds??[]);
  let files:DriveFile[]=[],removed:string[]=[],next:string|undefined,complete=false,finishToken=cursor.finishToken;
  if(cursor.pendingRemoved?.length){removed=cursor.pendingRemoved.slice(0,100);cursor.pendingRemoved=cursor.pendingRemoved.slice(100);complete=!cursor.pendingRemoved.length;}
  else if(cursor.changeToken&&cursor.mode!=="full"){
    const params=new URLSearchParams({pageToken:cursor.pageToken??cursor.changeToken,pageSize:"10",fields:"changes(fileId,removed,file(id,name,mimeType,size,version,modifiedTime,parents,trashed)),nextPageToken,newStartPageToken",supportsAllDrives:"true",includeItemsFromAllDrives:"true"});
    let page:{changes?:{fileId:string;removed?:boolean;file?:DriveFile}[];nextPageToken?:string;newStartPageToken?:string};
    try{page=await client.request("drive",`/changes?${params}`);}catch(error){if(error instanceof GoogleError&&(error.code==="expired_cursor"||error.code==="not_found"))return {files:[],cursor:{knownIds:[...known],mode:"full" as const},complete:false};throw error;}
    for(const change of page.changes??[]){if(change.removed||change.file?.trashed||!change.file?.parents?.includes(folder)){if(known.has(change.fileId)){removed.push(change.fileId);known.delete(change.fileId);}}else if(change.file&&change.file.mimeType!=="application/vnd.google-apps.folder"){files.push(change.file);known.add(change.fileId);}}
    next=page.nextPageToken;finishToken=page.newStartPageToken??cursor.changeToken;cursor.mode="changes";complete=!next;
  }else{
    if(!cursor.baseline)cursor.baseline=(await client.request<{startPageToken:string}>("drive","/changes/startPageToken?supportsAllDrives=true")).startPageToken;
    const params=new URLSearchParams({q:`'${folder}' in parents and trashed=false`,pageSize:"10",fields:"files(id,name,mimeType,size,version,modifiedTime,parents),nextPageToken",supportsAllDrives:"true",includeItemsFromAllDrives:"true"});if(cursor.pageToken)params.set("pageToken",cursor.pageToken);
    const page=await client.request<{files?:DriveFile[];nextPageToken?:string}>("drive",`/files?${params}`);
    files=(page.files??[]).filter(file=>file.mimeType!=="application/vnd.google-apps.folder");for(const file of files)seen.add(file.id);
    next=page.nextPageToken;cursor.mode="full";
    if(!next){finishToken=cursor.baseline;const missing=[...known].filter(id=>!seen.has(id));cursor.pendingRemoved=missing;cursor.finishToken=finishToken;complete=!missing.length;}
  }
  const rows:Record<string,unknown>[]=[];
  for(const file of files){
    let bytes:Uint8Array=new Uint8Array(),mime=file.mimeType;
    if(!file.size||Number(file.size)<=4*1024*1024){
      try{if(mime==="application/vnd.google-apps.document"){mime="text/plain";bytes=await client.request("drive",`/files/${encodeURIComponent(file.id)}/export?mimeType=text%2Fplain`,{responseType:"bytes"});}else if(mime==="application/pdf"||mime.startsWith("text/"))bytes=await client.request("drive",`/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,{responseType:"bytes"});}
      catch(error){if(error instanceof GoogleError&&["unavailable","disconnected"].includes(error.code))throw error;/* Unsupported/permission-limited file stays in visible review. */}
    }
    const extraction=await extractDocument(bytes,mime),classification=classifyDocument(file.name,extraction.text,context.types);
    rows.push({...file,version:file.version??file.modifiedTime??"unknown",text:extraction.text,extractionStatus:extraction.status,...classification});
  }
  rows.push(...removed.map(id=>({id,removed:true})));
  // A page has <=100 changes/files. Full-rescan removals use separate batches.
  if(rows.length>100)throw new Error("Invalid Drive batch size.");
  if(complete)return {files:rows,cursor:{changeToken:finishToken,knownIds:cursor.mode==="full"||cursor.pendingRemoved?[...seen]:[...known]} as DriveCursor,complete:true};
  cursor.pageToken=next;cursor.knownIds=[...known];cursor.seenIds=[...seen];return {files:rows,cursor,complete:false};
}
