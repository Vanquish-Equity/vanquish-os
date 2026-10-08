import type { GoogleClient } from "../google/transport";
import { GoogleError } from "../google/transport";
import type { GmailMessage } from "../google/mail-types";
import type { CalendarEvent } from "../google/calendar-types";
import { parseAddresses } from "../google/mail-validation";
import { resolveParticipants, type ResolutionIndex } from "./resolver";

type Item={id:string;deleted?:boolean};
export type SyncCursor={mailboxAddress?:string;watchExpiration?:string;historyId?:string;baseline?:string;syncToken?:string;pageToken?:string;mode?:"full"|"history";pending?:Item[];nextHistoryId?:string;nextPageToken?:string};
export type SourceEvent={id:string;companyId:string|null;dealId:string|null;candidates:string[];status:"matched"|"review"|"ignored"|"deleted";occurredAt:string|null;participants?:string[];subject?:string};
export type SyncBatch={events:SourceEvent[];cursor:SyncCursor;complete:boolean};
function removed(id:string):SourceEvent{return {id,companyId:null,dealId:null,candidates:[],status:"deleted",occurredAt:null};}
function occurred(value:string|undefined) { if(!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null; }
function header(message:GmailMessage,name:string){return message.payload?.headers?.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value??"";}

export async function gmailBatch(client:GoogleClient,index:ResolutionIndex,me:string,input:SyncCursor):Promise<SyncBatch> {
  const cursor={...input};
  if(!cursor.mailboxAddress){const profile=await client.request<{emailAddress:string}>("gmail","/profile");cursor.mailboxAddress=profile.emailAddress;}
  me=cursor.mailboxAddress;
  const topic=process.env.GMAIL_PUBSUB_TOPIC;
  if(topic&&(!cursor.watchExpiration||Number(cursor.watchExpiration)<Date.now()+86400000)) {
    const watch=await client.request<{expiration:string}>("gmail","/watch",{method:"POST",body:JSON.stringify({topicName:topic})});cursor.watchExpiration=watch.expiration;
  }
  let items=cursor.pending;
  if(!items?.length) {
    if(cursor.historyId && cursor.mode!=="full") {
      try {
        const params=new URLSearchParams({startHistoryId:cursor.historyId,maxResults:"100"});if(cursor.pageToken)params.set("pageToken",cursor.pageToken);
        const page=await client.request<{historyId:string;nextPageToken?:string;history?:{messagesAdded?:{message:{id:string}}[];messagesDeleted?:{message:{id:string}}[];labelsAdded?:{message:{id:string}}[];labelsRemoved?:{message:{id:string}}[]}[]}>("gmail",`/history?${params}`);
        const ids=new Map<string,Item>();
        for(const h of page.history??[]) {
          for(const entry of [...(h.messagesAdded??[]),...(h.labelsAdded??[]),...(h.labelsRemoved??[])]) ids.set(entry.message.id,{id:entry.message.id});
          for(const entry of h.messagesDeleted??[]) ids.set(entry.message.id,{id:entry.message.id,deleted:true});
        }
        items=[...ids.values()];cursor.mode="history";cursor.nextPageToken=page.nextPageToken;cursor.nextHistoryId=page.historyId;
      } catch(error) { if(!(error instanceof GoogleError)||error.code!=="not_found")throw error;cursor.mode="full";delete cursor.historyId;delete cursor.pageToken; }
    }
    if(!items) {
      // Capture history before the full listing; changes during pagination
      // will be replayed on the next history run, without a gap.
      if(!cursor.baseline)cursor.baseline=(await client.request<{historyId:string}>("gmail","/profile")).historyId;
      const params=new URLSearchParams({maxResults:"100",q:"newer_than:90d -in:spam -in:trash"});if(cursor.pageToken)params.set("pageToken",cursor.pageToken);
      const page=await client.request<{messages?:{id:string}[];nextPageToken?:string}>("gmail",`/messages?${params}`);
      items=page.messages??[];cursor.mode="full";cursor.nextPageToken=page.nextPageToken;
    }
  }
  const events:SourceEvent[]=[];
  // Bound a lease to <=10 metadata requests and process serially so API throttling
  // cannot turn one mailbox into an uncontrolled request fan-out.
  for(const item of items.slice(0,10)) {
    if(item.deleted){events.push(removed(item.id));continue;}
    let message:GmailMessage;
    try {message=await client.request<GmailMessage>("gmail",`/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`);}
    catch(error){if(error instanceof GoogleError&&error.code==="not_found"){events.push(removed(item.id));continue;}throw error;}
    if(message.labelIds?.some(label=>["TRASH","SPAM"].includes(label))){events.push(removed(item.id));continue;}
    const emails=new Set<string>();
    for(const name of ["From","To","Cc"]) {try{for(const email of parseAddresses(header(message,name)))if(email.toLowerCase()!==me.toLowerCase())emails.add(email);}catch{/* Malformed external header provides no matching evidence. */}}
    const resolution=resolveParticipants([...emails],index,header(message,"Subject"));
    const at=occurred(message.internalDate && Number.isFinite(Number(message.internalDate)) ? String(new Date(Number(message.internalDate))) : undefined);
    events.push({id:item.id,...resolution,occurredAt:at,participants:[...emails].map(email=>email.toLowerCase()),subject:header(message,"Subject").slice(0,500)});
  }
  const remaining=items.slice(10);
  if(remaining.length){cursor.pending=remaining;return {events,cursor,complete:false};}
  delete cursor.pending;
  if(cursor.nextPageToken){cursor.pageToken=cursor.nextPageToken;delete cursor.nextPageToken;return {events,cursor,complete:false};}
  const historyId=cursor.mode==="full"?cursor.baseline:cursor.nextHistoryId??cursor.historyId;
  return {events,cursor:{historyId,mailboxAddress:cursor.mailboxAddress,watchExpiration:cursor.watchExpiration},complete:true};
}

export async function calendarBatch(client:GoogleClient,index:ResolutionIndex,me:string,input:SyncCursor,now=new Date()):Promise<SyncBatch> {
  const cursor={...input};
  const params=new URLSearchParams({maxResults:"100",showDeleted:"true",singleEvents:"true"});
  if(cursor.syncToken)params.set("syncToken",cursor.syncToken);
  else params.set("timeMin",new Date(now.getTime()-90*86400000).toISOString());
  if(cursor.pageToken)params.set("pageToken",cursor.pageToken);
  let page:{items?:CalendarEvent[];nextPageToken?:string;nextSyncToken?:string};
  try{page=await client.request("calendar",`/calendars/primary/events?${params}`);}
  catch(error){if(error instanceof GoogleError&&error.code==="expired_cursor")return {events:[],cursor:{},complete:false};throw error;}
  const events=(page.items??[]).map(event=>{
    if(event.status==="cancelled" || event.attendees?.some(attendee=>attendee.self && attendee.responseStatus==="declined"))return removed(event.id);
    const emails=(event.attendees??[]).filter(a=>!a.self&&a.email.toLowerCase()!==me.toLowerCase()).map(a=>a.email);
    if(event.organizer?.email&&!event.organizer.self&&event.organizer.email.toLowerCase()!==me.toLowerCase())emails.push(event.organizer.email);
    const resolution=resolveParticipants(emails,index,event.summary);
    const at=occurred(event.start?.dateTime??event.start?.date);
    return {id:event.id,...resolution,occurredAt:at,participants:emails.map(email=>email.toLowerCase()),subject:event.summary?.slice(0,500)};
  });
  if(!page.nextPageToken&&!page.nextSyncToken)throw new GoogleError("unavailable","Calendar did not return a durable cursor.");
  return {events,cursor:page.nextPageToken?{...cursor,pageToken:page.nextPageToken}:{syncToken:page.nextSyncToken??cursor.syncToken},complete:!page.nextPageToken};
}
