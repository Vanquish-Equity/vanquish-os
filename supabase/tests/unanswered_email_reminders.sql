-- Disposable PostgreSQL only. All fixtures and guard mutations roll back.
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'P7 TEST: %',label; end if; end$$;
create function pg_temp.state(statement text) returns text language plpgsql as $$
begin execute statement; return 'ok'; exception when others then return sqlstate; end$$;
create function pg_temp.who(email text,sub text default null) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','email',email,'sub',sub)::text,true)
$$;
create temp table p7_leases(label text primary key,id uuid,lease uuid);
grant select,insert on p7_leases to authenticated;
create function pg_temp.claim(label text) returns void language sql as $$
 insert into p7_leases select label,(v->>'id')::uuid,(v->>'lease')::uuid from public.worker_claim_email_followup() q(v)
$$;
create function pg_temp.commit_batch(which text,rows jsonb) returns integer language sql as $$
 select public.worker_commit_email_followup(id,lease,rows) from p7_leases where label=which
$$;
create function pg_temp.context(which text) returns jsonb language sql as $$
 select public.worker_email_followup_context(id,lease) from p7_leases where label=which
$$;
create function pg_temp.at(days integer,seconds integer default 0) returns text language sql as $$
 select to_char((now() at time zone 'UTC')::date-days+make_interval(secs=>seconds),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
create function pg_temp.inbound(thread text,days integer,msg text default 'inbound',seconds integer default 0) returns jsonb language sql as $$
 select jsonb_build_object('kind','inbound','threadId',thread,'messageId',msg,'at',pg_temp.at(days,seconds),
   'sender','contact@external.synthetic.test','personId','70000000-0000-4000-8000-000000000001')
$$;
create function pg_temp.reply(thread text,days integer) returns jsonb language sql as $$
 select jsonb_build_object('kind','reply','threadId',thread,'messageId','reply','at',pg_temp.at(days))
$$;
create function pg_temp.mutant(sig text,needle text,replacement text,assertion text,label text) returns void language plpgsql as $$
declare original text; changed text; caught boolean:=false;
begin
  original:=pg_get_functiondef(sig::regprocedure);
  changed:=replace(original,needle,replacement);
  perform pg_temp.expect(changed<>original,'guard found: '||label);
  begin
    execute changed;
    begin execute assertion;
    exception when raise_exception then
      if sqlerrm<>'P7 TEST: '||label then raise; end if;
      caught:=true;
    end;
    raise exception 'Restore P7 mutant' using errcode='P7007';
  exception when sqlstate 'P7007' then null;
  end;
  perform pg_temp.expect(caught,'mutant detected: '||label);
  perform pg_temp.expect(pg_get_functiondef(sig::regprocedure)=original,'definition restored: '||label);
  raise notice 'P7 mutant detected/restored: %',label;
end$$;

insert into public.app_members(email,display_name,is_active) values
 ('p7.owner@workspace.synthetic.test','Synthetic Owner',true),
 ('p7.other@workspace.synthetic.test','Synthetic Other',true),
 ('p7.admin@workspace.synthetic.test','Synthetic Admin',true),
 ('p7.disabled@workspace.synthetic.test','Synthetic Disabled',false),
 ('p7.scope@workspace.synthetic.test','Synthetic Scope',true),
 ('p7.noconn@workspace.synthetic.test','Synthetic No Connection',true);
insert into public.member_permissions(email,permission) values('p7.admin@workspace.synthetic.test','admin');
insert into public.people(id,name) values('70000000-0000-4000-8000-000000000001','Synthetic Contact');
insert into public.person_emails(person_id,email,is_primary)
 values('70000000-0000-4000-8000-000000000001','contact@external.synthetic.test',true);
insert into public.google_mailbox_connections(email,granted_scopes,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)
 select email,case when email like 'p7.scope@%' then array['https://www.googleapis.com/auth/gmail.send']
   else array['https://www.googleapis.com/auth/gmail.readonly'] end,'synthetic','synthetic','synthetic'
 from public.app_members where email in ('p7.owner@workspace.synthetic.test','p7.other@workspace.synthetic.test',
   'p7.disabled@workspace.synthetic.test','p7.scope@workspace.synthetic.test');
insert into auth.users(id,email) values
 ('70000000-0000-4000-8000-000000000010','p7.worker@workspace.synthetic.test'),
 ('70000000-0000-4000-8000-000000000011','p7.second@workspace.synthetic.test');
insert into private.machine_identities(sub,enabled,relationships_only) values
 ('70000000-0000-4000-8000-000000000010',true,false),('70000000-0000-4000-8000-000000000011',true,false);

set local role anon;
select pg_temp.expect(pg_temp.state('select public.my_email_followup_state()')='42501','anon state denied');
select pg_temp.expect(pg_temp.state('select public.configure_email_followup(true)')='42501','anon configure denied');
select pg_temp.expect(pg_temp.state('select public.worker_claim_email_followup()')='42501','anon worker denied');
select pg_temp.expect(pg_temp.state('select * from private.email_followups')='42501','anon tables denied');
reset role;
set local role authenticated;
select pg_temp.who('p7.outsider@workspace.synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_email_followup(true)')='42501','nonmember denied');
select pg_temp.who('p7.disabled@workspace.synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_email_followup(true)')='42501','disabled member denied');
select pg_temp.who('p7.scope@workspace.synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_email_followup(true)')='42501','no read scope denied');
select pg_temp.who('p7.noconn@workspace.synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_email_followup(true)')='42501','no mailbox denied');
select pg_temp.who('p7.owner@workspace.synthetic.test');
select pg_temp.expect(public.my_email_followup_state()->>'enabled'='false','member off by default');
select pg_temp.expect(public.my_email_followup_state()->>'workerAvailable'='false','worker off by default');
select pg_temp.expect(pg_temp.state('select public.worker_claim_email_followup()')='42501','member cannot claim');
select public.configure_email_followup(true);
select pg_temp.who('p7.worker@workspace.synthetic.test','70000000-0000-4000-8000-000000000010');
select pg_temp.expect(pg_temp.state('select public.configure_email_followup(true)')='42501','machine cannot opt in');
select pg_temp.expect(pg_temp.state('select public.my_email_followup_state()')='42501','machine cannot see member settings');
select pg_temp.expect((select count(*)=0 from public.worker_claim_email_followup()),'capability default-off prevents claim');
reset role;

-- Stale enabled rows are skipped independently of revocation triggers.
insert into private.email_followup_accounts(member_email,enabled,next_run_at) values
 ('p7.disabled@workspace.synthetic.test',true,'-infinity'),
 ('p7.scope@workspace.synthetic.test',true,'-infinity'),
 ('p7.noconn@workspace.synthetic.test',true,'-infinity');
-- Fill the claim probe with stale rows if any eligibility join is removed.
insert into public.app_members(email,display_name,is_active)
 select 'p7.stale-'||kind||n||'@workspace.synthetic.test','Synthetic Stale',kind<>'disabled'
 from unnest(array['disabled','scope','noconn']) kind cross join generate_series(1,5)n;
insert into private.email_followup_accounts(member_email,enabled,next_run_at)
 select email,true,'-infinity' from public.app_members where email like 'p7.stale-%';
insert into public.google_mailbox_connections(email,granted_scopes,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)
 select email,case when email like 'p7.stale-scope%' then array['https://www.googleapis.com/auth/gmail.send']
   else array['https://www.googleapis.com/auth/gmail.readonly'] end,'synthetic','synthetic','synthetic'
 from public.app_members where email like 'p7.stale-disabled%' or email like 'p7.stale-scope%';
update private.machine_identities set followup_scanning_enabled=true where sub in
 ('70000000-0000-4000-8000-000000000010','70000000-0000-4000-8000-000000000011');
-- Mutants use the same valid owner plus stale candidates and are rolled back.
do $$declare guard text;begin
 foreach guard in array array[' and m.is_active',' and private.email_followup_read_scope(c.granted_scopes)',
   'join public.google_mailbox_connections c on c.email=s.member_email and private.email_followup_read_scope(c.granted_scopes)'] loop
  perform pg_temp.mutant('public.worker_claim_email_followup()',guard,'',
    'select pg_temp.claim(''mutant-stale''); select pg_temp.expect(pg_temp.context(''mutant-stale'')->>''ownEmail''=''p7.owner@workspace.synthetic.test'',''stale accounts cannot block owner'')',
    'stale accounts cannot block owner');
 end loop;
end$$;
set local role authenticated;
select pg_temp.claim('first');
select pg_temp.expect(pg_temp.context('first')->>'ownEmail'='p7.owner@workspace.synthetic.test','stale accounts do not block valid owner');
select pg_temp.expect(pg_temp.context('first')->>'windowDays'='14','first review fourteen days');
select pg_temp.expect((select count(*)=0 from public.worker_claim_email_followup()),'live lease exclusive');
select pg_temp.expect(pg_temp.state($q$select public.worker_email_followup_context(id,gen_random_uuid()) from p7_leases where label='first'$q$)='42501','wrong live token');
select pg_temp.who('p7.second@workspace.synthetic.test','70000000-0000-4000-8000-000000000011');
select pg_temp.expect(pg_temp.state($q$select pg_temp.context('first')$q$)='42501','another capable worker cannot steal lease');
select pg_temp.who('p7.other@workspace.synthetic.test');
select pg_temp.expect(pg_temp.state($q$select pg_temp.context('first')$q$)='42501','member cannot use live worker context');
select pg_temp.expect(pg_temp.state($q$select pg_temp.commit_batch('first','[]')$q$)='42501','member cannot use live worker commit');
select pg_temp.who('p7.worker@workspace.synthetic.test','70000000-0000-4000-8000-000000000010');
select pg_temp.expect(pg_temp.state('select * from private.email_followups')='42501','machine direct metadata denied');
reset role;

-- Hostile batches never save even their valid first row.
create temp table p7_invalid(label text,rows jsonb);
insert into p7_invalid values
 ('extra field',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('bad',5)||'{"subject":"synthetic forbidden"}')),
 ('invalid thread ID',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('bad/id',5))),
 ('invalid message ID',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('bad',5,'x/y'))),
 ('invalid date',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('bad',5)||'{"at":"2026-99-01T00:00:00.000Z"}')),
 ('future date',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('bad',-1))),
 ('oversized batch',(select jsonb_agg(pg_temp.inbound('batch'||n,5)) from generate_series(1,61)n)),
 ('duplicate thread',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('valid',6))),
 ('bad person ID',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('bad',5)||'{"personId":"not-id"}')),
 ('invalid sender',jsonb_build_array(pg_temp.inbound('valid',5),pg_temp.inbound('bad',5)||'{"sender":"not-address"}')),
 ('reply carries private fields',jsonb_build_array(pg_temp.reply('bad',1)||'{"sender":"contact@external.synthetic.test"}'));
create function pg_temp.reject_batch(rows jsonb,label text) returns void language plpgsql as $$
begin
 perform pg_temp.expect(pg_temp.state(format('select pg_temp.commit_batch(''first'',%L)',rows))='22023',label);
end$$;
select pg_temp.reject_batch(rows,label) from p7_invalid;
select pg_temp.expect(not exists(select 1 from private.email_followups),'hostile batch atomic');
select pg_temp.expect(not exists(select 1 from public.contact_reminders where email_followup_private),'hostile batch no reminders');

-- Remove each representative validation guard with a fresh valid lease.
do $$declare item record; payload jsonb;begin
 for item in select * from (values
  ('extra field',$q$or (r-array['kind','threadId','messageId','at','sender','personId'])<>'{}'::jsonb$q$),
  ('invalid thread ID',$q$or coalesce(r->>'threadId','') !~ '^[A-Za-z0-9_-]{1,250}$'$q$),
  ('invalid message ID',$q$or coalesce(r->>'messageId','') !~ '^[A-Za-z0-9_-]{1,250}$'$q$),
  ('future date',' or observed>now()'),
  ('reply carries private fields',$q$or (r->>'kind'='reply' and (r ? 'sender' or r ? 'personId'))$q$),
  ('invalid sender',$q$or coalesce(r->>'sender','') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'$q$),
  ('oversized batch',$q$if jsonb_array_length(p_rows)>60 then raise exception 'Invalid follow-up batch' using errcode='22023'; end if;$q$),
  ('duplicate thread',$q$if (select count(distinct value->>'threadId') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then
    raise exception 'Duplicate follow-up thread' using errcode='22023';
  end if;$q$)
 ) g(label,needle) loop
  select rows into payload from p7_invalid where label=item.label;
  perform pg_temp.mutant('private.validate_email_followup_batch(jsonb)',item.needle,'',
    format('select pg_temp.reject_batch(%L,%L)',payload,item.label),item.label);
 end loop;
end$$;
-- The table CHECKs also reject malformed IDs. For the two ID guard mutants the
-- state must change from explicit 22023 to the CHECK's 23514, not silently save.

select pg_temp.mutant('private.require_email_followup_job(uuid,uuid)',' and lease=p_lease','',
 $q$select pg_temp.expect(pg_temp.state('select public.worker_email_followup_context(id,gen_random_uuid()) from p7_leases where label=''first''')='42501','wrong live token')$q$,'wrong live token');
select pg_temp.mutant('private.require_email_followup_job(uuid,uuid)',' and worker_sub=auth.uid()','',
 $q$select pg_temp.who('p7.second@workspace.synthetic.test','70000000-0000-4000-8000-000000000011'); select pg_temp.expect(pg_temp.state('select pg_temp.context(''first'')')='42501','worker lease owner')$q$,'worker lease owner');
select pg_temp.who('p7.worker@workspace.synthetic.test','70000000-0000-4000-8000-000000000010');

-- Each fence uses a real lease and disables only the condition under test.
create temp table p7_first_job as select j.* from private.email_followup_jobs j join p7_leases l on l.id=j.id where l.label='first';
update private.email_followup_jobs set lease_until=now()-interval '1 second' where id=(select id from p7_first_job);
select pg_temp.expect(pg_temp.state($q$select pg_temp.context('first')$q$)='42501','expired lease cannot read');
select pg_temp.mutant('private.require_email_followup_job(uuid,uuid)','lease_until>now() and ','',
 $q$select pg_temp.expect(pg_temp.state('select pg_temp.context(''first'')')='42501','expired lease cannot read')$q$,'expired lease cannot read');
update private.email_followup_jobs j set lease_until=f.lease_until,generation=gen_random_uuid() from p7_first_job f where f.id=j.id;
select pg_temp.expect(pg_temp.state($q$select pg_temp.context('first')$q$)='42501','stale consent generation denied');
select pg_temp.mutant('private.require_email_followup_job(uuid,uuid)',' and generation=a.generation','',
 $q$select pg_temp.expect(pg_temp.state('select pg_temp.context(''first'')')='42501','stale consent generation denied')$q$,'stale consent generation denied');
update private.email_followup_jobs j set generation=f.generation,connection_version=f.connection_version-interval '1 second' from p7_first_job f where f.id=j.id;
select pg_temp.expect(pg_temp.state($q$select pg_temp.context('first')$q$)='42501','stale mailbox version denied');
select pg_temp.mutant('private.require_email_followup_job(uuid,uuid)',' and connection_version=version','',
 $q$select pg_temp.expect(pg_temp.state('select pg_temp.context(''first'')')='42501','stale mailbox version denied')$q$,'stale mailbox version denied');
update private.email_followup_jobs j set connection_version=f.connection_version from p7_first_job f where f.id=j.id;
update private.machine_identities set followup_scanning_enabled=false where sub='70000000-0000-4000-8000-000000000010';
-- Recreate only the synthetic lease to isolate capability from the trigger.
insert into private.email_followup_jobs select * from p7_first_job;
select pg_temp.expect(pg_temp.state($q$select pg_temp.context('first')$q$)='42501','capability required on live context');
select pg_temp.mutant('private.require_email_followup_worker()',' and followup_scanning_enabled','',
 $q$select pg_temp.expect(pg_temp.state('select pg_temp.context(''first'')')='42501','capability required on live context')$q$,'capability required on live context');
update private.machine_identities set followup_scanning_enabled=true where sub='70000000-0000-4000-8000-000000000010';

-- Date boundaries and sender revalidation.
create function pg_temp.first_window() returns void language plpgsql as $$
begin
 perform pg_temp.expect(pg_temp.commit_batch('first',jsonb_build_array(pg_temp.inbound('too-young',4),
   pg_temp.inbound('minimum',5),pg_temp.inbound('first-limit',14),pg_temp.inbound('outside-first',15),
   pg_temp.inbound('outside-ever',31),pg_temp.inbound('wrong-sender',7)||'{"sender":"unknown@external.synthetic.test"}'))=2,
   'first review window and exact sender');
end$$;
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)','age_days<5 or ','',
 'select pg_temp.first_window()','first review window and exact sender');
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)','when a.first_review then 14','when a.first_review then 30',
 'select pg_temp.first_window()','first review window and exact sender');
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)','where lower(e.email)=sender','where e.person_id=p.id',
 'select pg_temp.first_window()','first review window and exact sender');
select pg_temp.first_window();
select pg_temp.expect((select count(*)=2 and bool_and(visibility='private' and due_on=(now() at time zone 'UTC')::date
  and title='Reply to Synthetic Contact' and created_by='p7.owner@workspace.synthetic.test') from public.contact_reminders where email_followup_private),'private generic owner reminders');
select pg_temp.expect(not exists(select 1 from public.contact_reminder_recipients r join public.contact_reminders c on c.id=r.reminder_id where c.email_followup_private),'no reminder recipients');
select pg_temp.expect(not exists(select 1 from public.notifications where recipient_email like 'p7.%'),'zero notifications');

create temp table p7_reminders as select thread_id,reminder_id from private.email_followups;
grant select on p7_reminders to authenticated;
create function pg_temp.manual_handle() returns void language plpgsql as $$
begin
 perform pg_temp.who('p7.owner@workspace.synthetic.test');
 perform public.complete_contact_reminder((select reminder_id from p7_reminders where thread_id='minimum'));
 delete from public.contact_reminders where id=(select reminder_id from p7_reminders where thread_id='first-limit');
 perform pg_temp.expect((select count(*)=2 and bool_and(status='handled') from private.email_followups),'completion and deletion handled');
end$$;
select pg_temp.mutant('private.handle_email_followup_reminder()',
 $q$if old.email_followup_private and (tg_op='DELETE' or (old.completed_at is null and new.completed_at is not null)) then$q$,'if false then',
 'select pg_temp.manual_handle()','completion and deletion handled');
set local role authenticated;
select pg_temp.who('p7.other@workspace.synthetic.test');
select pg_temp.expect((select count(*)=0 from public.contact_reminders where email_followup_private),'other cannot read');
select pg_temp.expect(pg_temp.state($q$select public.complete_contact_reminder(reminder_id) from p7_reminders$q$)='42501','other cannot complete');
with d as (delete from public.contact_reminders where email_followup_private returning id)
select pg_temp.expect((select count(*)=0 from d),'other cannot delete');
select pg_temp.expect(pg_temp.state('select * from private.email_followups')='42501','other cannot read ledger');
select pg_temp.who('p7.admin@workspace.synthetic.test');
select pg_temp.expect((select count(*)=0 from public.contact_reminders where email_followup_private),'admin cannot read');
select pg_temp.expect(pg_temp.state($q$select public.complete_contact_reminder(reminder_id) from p7_reminders$q$)='42501','admin cannot complete');
with d as (delete from public.contact_reminders where email_followup_private returning id)
select pg_temp.expect((select count(*)=0 from d),'admin cannot delete');
select pg_temp.expect(pg_temp.state('select * from private.email_followups')='42501','admin cannot read ledger');
select pg_temp.who('p7.owner@workspace.synthetic.test');
select pg_temp.expect((select count(*)=2 from public.my_contact_reminders()),'owner sees reminders in Home RPC');
select pg_temp.expect(pg_temp.state($q$update public.contact_reminders set visibility='team' where email_followup_private$q$)='23514','generated reminder cannot be shared');
select public.complete_contact_reminder((select reminder_id from p7_reminders where thread_id='minimum'));
delete from public.contact_reminders where id=(select reminder_id from p7_reminders where thread_id='first-limit');
reset role;
select pg_temp.expect((select count(*)=2 and bool_and(status='handled') from private.email_followups),'completion and deletion handled');

-- Exercise the generated-privacy CHECK under the actual authenticated owner,
-- separately from the pre-existing owner-only policies.
do $$declare detected boolean:=false;begin
 begin
  alter table public.contact_reminders drop constraint contact_reminders_email_followup_private;
  execute 'set local role authenticated';
  begin
   perform pg_temp.expect(pg_temp.state('update public.contact_reminders set visibility=''team'' where email_followup_private')='23514',
    'generated reminder cannot be shared');
  exception when raise_exception then
   if sqlerrm<>'P7 TEST: generated reminder cannot be shared' then raise; end if;
   detected:=true;
  end;
  raise exception 'Restore P7 CHECK' using errcode='P7007';
 exception when sqlstate 'P7007' then null;
 end;
 perform pg_temp.expect(detected,'privacy CHECK mutant detected and restored');
 raise notice 'P7 mutant detected/restored: generated reminder cannot be shared';
end$$;

select pg_temp.who('p7.worker@workspace.synthetic.test','70000000-0000-4000-8000-000000000010');
update private.email_followup_accounts set next_run_at=now() where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('second');
select pg_temp.expect(pg_temp.context('second')->>'windowDays'='30','later review thirty days');
create function pg_temp.repeat_inbound() returns void language plpgsql as $$
begin
 perform pg_temp.expect(pg_temp.commit_batch('second',jsonb_build_array(pg_temp.inbound('minimum',5),
   pg_temp.inbound('first-limit',14),pg_temp.inbound('outside-ever',31)))=0,'same inbound and too old never recreate');
end$$;
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)',
 $q$if f.thread_id is not null and (at_time<=f.last_inbound_at or r->>'messageId'=f.last_inbound_message_id) then continue; end if;$q$,'',
 'select pg_temp.repeat_inbound()','same inbound and too old never recreate');
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)','when a.first_review then 14 else 30','when a.first_review then 14 else 31',
 'select pg_temp.repeat_inbound()','same inbound and too old never recreate');
select pg_temp.repeat_inbound();
update private.email_followup_accounts set next_run_at=now() where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('newer');
select pg_temp.expect(pg_temp.commit_batch('newer',jsonb_build_array(pg_temp.inbound('minimum',5,'new-inbound',1),
 pg_temp.inbound('thirty',30)))=2,'new inbound may reopen and thirty accepted');
select pg_temp.expect((select count(*)=1 from private.email_followups where thread_id='minimum' and status='pending'),'one open per thread');
update private.email_followup_accounts set next_run_at=now() where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('still-pending');
create function pg_temp.pending_once() returns void language plpgsql as $$
begin
 perform pg_temp.expect(pg_temp.commit_batch('still-pending',jsonb_build_array(pg_temp.inbound('minimum',5,'newest-inbound',2)))=0,
  'pending thread cannot create another open reminder');
end$$;
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)',$q$if f.status='pending' then$q$,'if false then',
 'select pg_temp.pending_once()','pending thread cannot create another open reminder');
select pg_temp.pending_once();

update private.email_followup_accounts set next_run_at=now() where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('answered');
select pg_temp.expect(pg_temp.context('answered')->'pendingThreads' ? 'minimum','pending threads tracked outside inbox');
create function pg_temp.answer_reminder() returns void language plpgsql as $$
begin
 perform pg_temp.expect(pg_temp.commit_batch('answered',jsonb_build_array(pg_temp.reply('minimum',1)))=0,'reply does not create reminder');
 perform pg_temp.expect((select f.status='answered' and c.completed_at is not null and c.completed_by=f.member_email
  from private.email_followups f join public.contact_reminders c on c.id=f.reminder_id where f.thread_id='minimum'),
  'reply completes only generated owner reminder');
end$$;
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)',
 $q$if f.status='pending' and at_time>f.last_inbound_at and r->>'messageId'<>f.last_inbound_message_id then$q$,'if false then',
 'select pg_temp.answer_reminder()','reply completes only generated owner reminder');
select pg_temp.answer_reminder();

-- The daily budget counts creations even if a reminder is deleted.
update private.email_followup_accounts set next_run_at=now(),creation_day=(now() at time zone 'UTC')::date-1
 where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('daily');
create function pg_temp.daily_limit() returns void language plpgsql as $$
declare rows jsonb;
begin
 select jsonb_agg(pg_temp.inbound('daily'||n,5) order by n) into rows from generate_series(1,11)n;
 perform pg_temp.expect(pg_temp.state(format('select pg_temp.commit_batch(''daily'',%L)',rows))='ok','daily cap checkpoint');
end$$;
select pg_temp.mutant('public.worker_commit_email_followup(uuid,uuid,jsonb)','if daily_count>=10 then continue; end if;','',
 'select pg_temp.daily_limit()','daily cap checkpoint');
select pg_temp.expect(pg_temp.commit_batch('daily',(select jsonb_agg(pg_temp.inbound('daily'||n,5)) from generate_series(1,11)n))=10,'ten daily max');
select pg_temp.expect((select count(*)=10 from private.email_followups where thread_id like 'daily%'),'only ten saved');
delete from public.contact_reminders where id=(select reminder_id from private.email_followups where thread_id='daily1');
update private.email_followup_accounts set next_run_at=now() where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('full');
select pg_temp.expect(pg_temp.commit_batch('full',jsonb_build_array(pg_temp.inbound('daily9',5)))=0,'deleting does not refund daily budget');
update private.email_followup_accounts set next_run_at=now(),creation_day=(now() at time zone 'UTC')::date-1
 where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('tomorrow');
select pg_temp.expect(pg_temp.commit_batch('tomorrow',jsonb_build_array(pg_temp.inbound('daily9',5)))=1,'next UTC day can create overflow');

update private.email_followup_accounts set next_run_at=now() where member_email='p7.owner@workspace.synthetic.test';
select pg_temp.claim('revoked');
create temp table p7_revoked_job as select j.* from private.email_followup_jobs j join p7_leases l on l.id=j.id where l.label='revoked';
select pg_temp.who('p7.owner@workspace.synthetic.test');
select public.configure_email_followup(false);
select pg_temp.who('p7.worker@workspace.synthetic.test','70000000-0000-4000-8000-000000000010');
select pg_temp.expect(pg_temp.state($q$select pg_temp.commit_batch('revoked',jsonb_build_array(pg_temp.inbound('revoked',5)))$q$)='42501','opt out fences commit');
select pg_temp.expect((select count(*)=0 from public.worker_claim_email_followup()),'off and stale accounts do not claim');
select pg_temp.expect(exists(select 1 from public.contact_reminders where email_followup_private),'opt out keeps reminders');
-- A valid-looking live lease cannot override disabled consent.
insert into private.email_followup_jobs select * from p7_revoked_job;
update private.email_followup_jobs j set generation=a.generation from private.email_followup_accounts a where j.member_email=a.member_email;
select pg_temp.expect(pg_temp.state($q$select pg_temp.context('revoked')$q$)='42501','disabled consent rechecked despite live lease');
select pg_temp.mutant('private.require_email_followup_job(uuid,uuid)',' and enabled for update',' for update',
 $q$select pg_temp.expect(pg_temp.state('select pg_temp.context(''revoked'')')='42501','disabled consent rechecked despite live lease')$q$,
 'disabled consent rechecked despite live lease');
delete from private.email_followup_jobs where id=(select id from p7_revoked_job);

create function pg_temp.revoke_connection(kind text,label text) returns void language plpgsql as $$
declare c public.google_mailbox_connections;
begin
 perform pg_temp.who('p7.owner@workspace.synthetic.test');
 perform public.configure_email_followup(true);
 if kind='disconnect' then
   select * into c from public.google_mailbox_connections where email='p7.owner@workspace.synthetic.test';
   delete from public.google_mailbox_connections where email=c.email;
   insert into public.google_mailbox_connections select (c).*;
 elsif kind='replace' then
   update public.google_mailbox_connections set refresh_token_tag='replacement' where email='p7.owner@workspace.synthetic.test';
 else
   update public.google_mailbox_connections set granted_scopes=array['https://www.googleapis.com/auth/gmail.send'] where email='p7.owner@workspace.synthetic.test';
   update public.google_mailbox_connections set granted_scopes=array['https://www.googleapis.com/auth/gmail.modify'] where email='p7.owner@workspace.synthetic.test';
 end if;
 perform pg_temp.expect(public.my_email_followup_state()->>'enabled'='false'
   and public.my_email_followup_state()->>'lastError'='revoked',label);
end$$;
do $$declare kind text; label text;begin
 foreach kind in array array['disconnect','replace','scope'] loop
  label:='new consent after '||kind;
  perform pg_temp.mutant('private.fence_email_followup()','set enabled=false,generation=gen_random_uuid(),last_error=''revoked''',
    'set generation=gen_random_uuid(),last_error=''revoked''',format('select pg_temp.revoke_connection(%L,%L)',kind,label),label);
  perform pg_temp.revoke_connection(kind,label);
 end loop;
end$$;
rollback;
