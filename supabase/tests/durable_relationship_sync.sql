-- Synthetic only. Run after the full migration chain in a disposable DB.
begin;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'DURABLE RELATIONSHIP TEST: %',label;end if;end$$;
create or replace function pg_temp.denied(q text) returns boolean language plpgsql as $$
begin execute q;return false;exception when insufficient_privilege then return true;end$$;
insert into public.app_members(email) values('durable.one@example.test'),('durable.two@example.test');
insert into public.google_mailbox_connections(email,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)
  values('durable.one@example.test','synthetic','synthetic','synthetic'),('durable.two@example.test','synthetic','synthetic','synthetic');
insert into public.people(id,name) values('ab000000-0000-0000-0000-000000000001','Durable contact');
insert into public.person_emails(person_id,email,is_primary) values('ab000000-0000-0000-0000-000000000001','contact@external.test',true);
create temp table test_lease(id uuid,lease uuid,service text);grant all on test_lease to authenticated,vanquish_worker;
create temp table test_ids(gmail uuid,calendar uuid);grant all on test_ids to authenticated,vanquish_worker;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.one@example.test"}',true);
select public.configure_relationship_sync(true);
select public.request_crm_sync();select public.request_crm_sync();
select pg_temp.expect((select count(*)=2 from public.crm_sync_jobs where status in ('pending','running','retry')),'two services, no duplicate queue');
select pg_temp.expect((select not enabled and not share_subjects from public.crm_sync_accounts),'relationship consent does not enable CRM or subjects');
select pg_temp.expect(pg_temp.denied('update public.relationship_sync set enabled=false'),'direct consent write denied');
select pg_temp.expect(pg_temp.denied('insert into public.relationship_interactions values(''ab000000-0000-0000-0000-000000000001'',''durable.one@example.test'',''email'',''2026-09-01'',''2026-09-01'')'),'browser cannot bypass durable publication');
insert into test_ids select max(id::text) filter(where service='gmail')::uuid,max(id::text) filter(where service='calendar')::uuid from public.crm_sync_jobs;
reset role;
update public.crm_sync_jobs set next_run_at=now()+interval '1 day' where service='calendar';
set local role vanquish_worker;
select set_config('request.jwt.claims','{"role":"vanquish_worker"}',true);
insert into test_lease select id,lease,service from public.worker_claim_sync();
select pg_temp.expect((select service='gmail' from test_lease),'claim relationship-only Gmail');
select pg_temp.expect((public.worker_sync_context((select id from test_lease),(select lease from test_lease))->>'publishCrm')::boolean=false,'context denies CRM sink');
select pg_temp.expect(public.worker_sync_context((select id from test_lease),(select lease from test_lease))->'domains'='[]','relationship-only context has no Company resolution catalog');
select pg_temp.expect(jsonb_array_length(public.worker_sync_context((select id from test_lease),(select lease from test_lease))->'relationshipPeople')=1,'known active People provided privately');
select pg_temp.expect(pg_temp.denied('select * from public.google_mailbox_connections'),'worker has no direct token table');
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),
 '[{"id":"m1","status":"ignored","occurredAt":"2026-09-01T10:00:00Z","subject":"Must not persist","relationshipParticipants":["contact@external.test"]},{"id":"m2","status":"ignored","occurredAt":"2026-09-01T15:00:00Z","relationshipParticipants":["CONTACT@external.test"]}]',
 '{"historyId":"checkpoint-1","mailboxAddress":"durable.one@example.test"}',true);
reset role;
select pg_temp.expect((select count(*)=1 and max(last_at)='2026-09-01T15:00:00Z' from public.relationship_interactions where member_email='durable.one@example.test'),'daily deduplication keeps latest');
select pg_temp.expect(not exists(select 1 from public.crm_source_events where email='durable.one@example.test'),'relationship-only never stores CRM subjects/events');
select pg_temp.expect((select count(*)=2 from private.relationship_source_contributions),'source provenance private');
update public.crm_sync_jobs set status='pending',completed_at=null where id=(select gmail from test_ids);
truncate test_lease;set local role vanquish_worker;
insert into test_lease select id,lease,service from public.worker_claim_sync();
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),
 '[{"id":"m1","status":"ignored","occurredAt":"2026-09-01T10:00:00Z","relationshipParticipants":["contact@external.test"]},{"id":"m2","status":"ignored","occurredAt":"2026-09-01T15:00:00Z","relationshipParticipants":["contact@external.test"]}]','{"historyId":"checkpoint-replay"}',true);
reset role;
select pg_temp.expect((select count(*)=2 from private.relationship_source_contributions),'replay does not duplicate provenance');
select pg_temp.expect((select count(*)=1 and max(last_at)='2026-09-01T15:00:00Z' from public.relationship_interactions where member_email='durable.one@example.test'),'replay cannot regress latest');

-- Existing history without provider IDs survives replacement/cancellation.
insert into private.relationship_legacy_history values('ab000000-0000-0000-0000-000000000001','durable.one@example.test','meeting','2026-09-02','2026-09-02T14:00:00Z');
update public.crm_sync_jobs set next_run_at=now() where id=(select calendar from test_ids);
truncate test_lease;set local role vanquish_worker;
insert into test_lease select id,lease,service from public.worker_claim_sync();
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),jsonb_build_array(
 jsonb_build_object('id','c1','status','ignored','occurredAt','2026-09-02T10:00:00Z','relationshipParticipants',jsonb_build_array('contact@external.test')),
 jsonb_build_object('id','c2','status','ignored','occurredAt','2026-09-02T15:00:00Z','relationshipParticipants',jsonb_build_array('contact@external.test')),
 jsonb_build_object('id','future','status','ignored','occurredAt',now()+interval '1 day','relationshipParticipants',jsonb_build_array('contact@external.test'))),'{"syncToken":"checkpoint-calendar"}',true);
reset role;
select pg_temp.expect((select count(*)=1 and max(last_at)='2026-09-02T15:00:00Z' from public.relationship_interactions where kind='meeting' and member_email='durable.one@example.test'),'future meeting not published');
-- Simulate time becoming due without Google reporting an event change.
update private.relationship_source_contributions set last_at='2026-09-03T12:00:00Z' where provider_id='future';
set local role vanquish_worker;
select count(*) from public.worker_claim_sync();
reset role;
select pg_temp.expect(exists(select 1 from public.relationship_interactions where member_email='durable.one@example.test' and kind='meeting' and occurred_on='2026-09-03'),'scheduler publishes due meeting without changed cursor');
update public.crm_sync_jobs set status='pending',completed_at=null where id=(select calendar from test_ids);
truncate test_lease;set local role vanquish_worker;
insert into test_lease select id,lease,service from public.worker_claim_sync();
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),'[{"id":"c2","status":"deleted"},{"id":"future","status":"deleted"}]','{}',true);
reset role;
select pg_temp.expect((select last_at='2026-09-02T14:00:00Z' from public.relationship_interactions where kind='meeting' and member_email='durable.one@example.test'),'cancelling latest retains legacy baseline and other source');
select pg_temp.expect(exists(select 1 from private.relationship_source_contributions where provider_id='c1'),'other meeting source retained');

-- Retry preserves checkpoints and cannot target another member or duplicate work.
update public.crm_sync_jobs set status='dead' where id=(select gmail from test_ids);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.two@example.test"}',true);
select pg_temp.expect((select count(*)=0 from public.crm_sync_jobs),'other member cannot inspect private jobs');
select pg_temp.expect((select count(*)=0 from public.my_sync_health()),'other member health is empty');
select pg_temp.expect(pg_temp.denied(format('select public.retry_crm_sync_job(%L)',(select gmail from test_ids))),'other member retry denied');
select pg_temp.expect(pg_temp.denied('select * from private.relationship_source_contributions'),'source identities are not member-readable');
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.one@example.test"}',true);
select public.retry_crm_sync_job((select gmail from test_ids));select public.retry_crm_sync_job((select gmail from test_ids));
select pg_temp.expect((select count(*)=1 from public.crm_sync_jobs where service='gmail' and status='pending'),'retry clicks deduplicate');
select pg_temp.expect((select cursor='{"historyId":"checkpoint-replay"}' from public.crm_sync_jobs where service='gmail' and status='pending'),'retry preserves last committed cursor');
select pg_temp.expect((select cursor_updated_at is not null from public.my_sync_health() where service='gmail'),'checkpoint time recorded');
reset role;
truncate test_lease;set local role vanquish_worker;
insert into test_lease select id,lease,service from public.worker_claim_sync();
reset role;
update public.app_members set is_active=false where email='durable.one@example.test';
set local role vanquish_worker;
select pg_temp.expect(pg_temp.denied(format('select public.worker_commit_sync(%L,%L,''[]'',''{}'',true)',(select id from test_lease),(select lease from test_lease))),'deactivated member lease cannot publish');
reset role;update public.app_members set is_active=true where email='durable.one@example.test';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.one@example.test"}',true);
select public.configure_relationship_sync(false);
select pg_temp.expect(pg_temp.denied(format('select public.retry_crm_sync_job(%L)',(select gmail from test_ids))),'retry denied without either consent');
reset role;set local role vanquish_worker;
select pg_temp.expect(pg_temp.denied(format('select public.worker_commit_sync(%L,%L,''[]'',''{}'',true)',(select id from test_lease),(select lease from test_lease))),'opt out invalidates running lease');
reset role;
select pg_temp.expect((select count(*)=2 from public.relationship_interactions where member_email='durable.one@example.test'),'pause preserves previously published history');

-- Public member RPCs fail closed for inactive and missing membership.
update public.app_members set is_active=false where email='durable.two@example.test';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.two@example.test"}',true);
select pg_temp.expect(pg_temp.denied('select public.configure_relationship_sync(true)'),'inactive consent denied');
select pg_temp.expect((select count(*)=0 from public.my_sync_health()),'inactive health empty');
select set_config('request.jwt.claims','{"role":"authenticated","email":"not-a-member@example.test"}',true);
select pg_temp.expect(pg_temp.denied('select public.configure_relationship_sync(true)'),'nonmember consent denied');
select pg_temp.expect(pg_temp.denied('select public.delete_my_relationship_history()'),'nonmember deletion denied');
reset role;
update public.app_members set is_active=true where email='durable.two@example.test';

-- CRM-only does not recreate history; both consents still share two jobs.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.one@example.test"}',true);
select public.configure_crm_sync(true,false);
select public.delete_my_relationship_history();
select public.configure_relationship_sync(true);
select public.request_crm_sync();
select pg_temp.expect((select count(*)=2 from public.crm_sync_jobs where service in ('gmail','calendar') and status in ('pending','running','retry')),'both sinks share service queue');
select public.configure_relationship_sync(false);
reset role;
update public.crm_sync_jobs set next_run_at=now()+interval '1 day' where service='calendar' and status='pending';
truncate test_lease;set local role vanquish_worker;
insert into test_lease select id,lease,service from public.worker_claim_sync();
select pg_temp.expect(public.worker_sync_context((select id from test_lease),(select lease from test_lease))->'relationshipPeople'='[]','CRM-only context withholds relationship directory');
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),'[{"id":"crm-only","status":"ignored","occurredAt":"2026-09-03","relationshipParticipants":["contact@external.test"]}]','{}',true);
reset role;
select pg_temp.expect(not exists(select 1 from public.relationship_interactions where member_email='durable.one@example.test'),'CRM-only cannot publish relationship history');

-- Withdrawal includes provenance and preserves another publisher.
insert into private.relationship_source_contributions values('durable.one@example.test','gmail','withdraw-me','ab000000-0000-0000-0000-000000000001','2026-09-04');
insert into private.relationship_legacy_history values('ab000000-0000-0000-0000-000000000001','durable.one@example.test','email','2026-09-04','2026-09-04');
insert into public.relationship_interactions values('ab000000-0000-0000-0000-000000000001','durable.one@example.test','email','2026-09-04','2026-09-04');
insert into public.relationship_interactions values('ab000000-0000-0000-0000-000000000001','durable.two@example.test','email','2026-09-03','2026-09-03');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.one@example.test"}',true);
select public.disconnect_and_withdraw_sync();
reset role;
select pg_temp.expect(not exists(select 1 from private.relationship_source_contributions where member_email='durable.one@example.test'),'withdraw removes source provenance');
select pg_temp.expect(not exists(select 1 from private.relationship_legacy_history where member_email='durable.one@example.test'),'withdraw removes legacy provenance');
select pg_temp.expect(not exists(select 1 from public.crm_sync_jobs where email='durable.one@example.test'),'withdraw removes durable jobs');
select pg_temp.expect(not exists(select 1 from public.relationship_interactions where member_email='durable.one@example.test'),'withdraw removes shared relationship history');
select pg_temp.expect(exists(select 1 from public.relationship_interactions where member_email='durable.two@example.test'),'other member history retained');
select pg_temp.expect(not has_function_privilege('anon','public.configure_relationship_sync(boolean)','execute'),'anon cannot grant consent');
select pg_temp.expect(not has_function_privilege('vanquish_worker','public.retry_crm_sync_job(uuid)','execute'),'worker cannot use member retry RPC');
select pg_temp.expect(not has_function_privilege('authenticated','private.worker_commit_crm_sync(uuid,uuid,jsonb,jsonb,boolean)','execute'),'private CRM delegate not callable');
rollback;
