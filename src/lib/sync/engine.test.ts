import {describe,it,expect,vi,afterEach} from 'vitest';
import {gmailBatch,calendarBatch} from './engine';
import {GoogleError,type GoogleClient} from '../google/transport';
import {resolveParticipants,type ResolutionIndex} from './resolver';
const index:ResolutionIndex={domains:[{companyId:'a',domain:'alpha.test'},{companyId:'b',domain:'beta.test'}],people:[{email:'person@personal.test',companyId:'a'}],deals:[{id:'round-a',companyId:'a'},{id:'round-b1',companyId:'b'},{id:'round-b2',companyId:'b'}]};
const client=(work:(service:string,path:string)=>unknown):GoogleClient=>({scopes:[],request:vi.fn(async(service,path)=>work(service,path)) as GoogleClient['request']});
afterEach(()=>vi.unstubAllEnvs());
describe('deterministic resolution',()=>{
 it('resolves exact person before a conflicting domain, and never picks one of multiple rounds',()=>{expect(resolveParticipants(['PERSON@PERSONAL.TEST'],index)).toMatchObject({companyId:'a',dealId:'round-a',status:'matched'});expect(resolveParticipants(['x@beta.test'],index)).toMatchObject({companyId:'b',dealId:null});});
 it('queues multiple-company and name-only evidence instead of guessing',()=>{expect(resolveParticipants(['a@alpha.test','b@beta.test'],index)).toMatchObject({companyId:null,status:'review'});expect(resolveParticipants([],{...index,aliases:[{companyId:'a',name:'Alpha Labs'}]},'Alpha Labs round')).toMatchObject({companyId:null,status:'review'});});
 it('honors a learned correction and blocks inaccessible rounds',()=>{expect(resolveParticipants(['person@personal.test'],{...index,rules:[{email:'person@personal.test',companyId:'b',dealId:'round-b2'}]})).toMatchObject({companyId:'b',dealId:'round-b2'});expect(resolveParticipants(['x@alpha.test'],{...index,deals:[{id:null,companyId:'a',blocked:true}]})).toMatchObject({companyId:null,status:'review'});});
});
describe('incremental Google sync',()=>{
 it('does not advance Gmail history until every pending ID is processed',async()=>{
  vi.stubEnv('GMAIL_PUBSUB_TOPIC','');
  const google=client((_service,path)=>path.startsWith('/history')?{historyId:'20',history:[{messagesAdded:Array.from({length:11},(_,i)=>({message:{id:`m${i}`}}))}]}:{id:path.split('/')[2].split('?')[0],internalDate:'1790812800000',payload:{headers:[{name:'From',value:'x@alpha.test'}]}});
  const first=await gmailBatch(google,index,'me@test.test',{historyId:'10',mailboxAddress:'me@test.test'});
  expect(first.complete).toBe(false);expect(first.cursor.historyId).toBe('10');expect(first.cursor.pending).toHaveLength(1);
  const second=await gmailBatch(google,index,'me@test.test',first.cursor);expect(second.complete).toBe(true);expect(second.cursor.historyId).toBe('20');expect(second.events).toHaveLength(1);
 });
 it('resets expired history using a profile baseline captured before the full listing',async()=>{
  vi.stubEnv('GMAIL_PUBSUB_TOPIC','');const calls:string[]=[];
  const google=client((_service,path)=>{calls.push(path);if(path.startsWith('/history'))throw new GoogleError('not_found','expired');if(path==='/profile')return {historyId:'30'};return {messages:[]};});
  const result=await gmailBatch(google,index,'me@test.test',{historyId:'10',mailboxAddress:'me@test.test'});expect(result.cursor.historyId).toBe('30');expect(calls.findIndex(p=>p==='/profile')).toBeLessThan(calls.findIndex(p=>p.startsWith('/messages?')));
 });
 it('resets Calendar 410 and preserves cancellations without attendees',async()=>{
  expect(await calendarBatch(client(()=>{throw new GoogleError('expired_cursor','reset');}),index,'me@test.test',{syncToken:'old'})).toEqual({events:[],cursor:{},complete:false});
  const result=await calendarBatch(client(()=>({items:[{id:'cancelled',status:'cancelled'}],nextSyncToken:'next'})),index,'me@test.test',{});expect(result.events[0]).toMatchObject({id:'cancelled',status:'deleted',companyId:null});expect(result.cursor.syncToken).toBe('next');
 });
});
