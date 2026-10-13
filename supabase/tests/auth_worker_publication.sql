begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'AUTH PUBLICATION TEST: %',label;end if;end$$;
create function pg_temp.denied(q text) returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
insert into auth.users values('aaaaaaaa-0000-0000-0000-000000000099','service@machine.test');
insert into private.machine_identities(sub,relationships_only) values('aaaaaaaa-0000-0000-0000-000000000099',false);
insert into public.app_members(email) values('publisher@machine.test');
insert into public.member_permissions values('publisher@machine.test','documents');
insert into public.companies(id,name) values('dddddddd-0000-0000-0000-000000000001','Synthetic Auth Company');
insert into public.deals(id,company_id,name,restricted,stage_id) values('dddddddd-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001','Synthetic restricted round',true,(select id from public.pipeline_stages order by sort_order limit 1));
insert into public.deal_access_members values('dddddddd-0000-0000-0000-000000000002','publisher@machine.test','editor');
insert into public.google_mailbox_connections(email,refresh_token_encrypted,refresh_token_iv,refresh_token_tag) values('publisher@machine.test','synthetic','synthetic','synthetic');
insert into public.crm_sync_accounts(email,enabled) values('publisher@machine.test',true);
insert into public.drive_sources(id,email,folder_id,company_id,deal_id) values('dddddddd-0000-0000-0000-000000000003','publisher@machine.test','synthetic-folder','dddddddd-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002');
insert into public.crm_sync_jobs(id,email,service,status,lease,locked_until) values('dddddddd-0000-0000-0000-000000000004','publisher@machine.test','gmail','running','aaaaaaaa-0000-0000-0000-000000000004',now()+interval '5 minutes');
insert into public.crm_sync_jobs(id,email,service,drive_source_id,status,lease,locked_until) values('dddddddd-0000-0000-0000-000000000005','publisher@machine.test','drive','dddddddd-0000-0000-0000-000000000003','running','aaaaaaaa-0000-0000-0000-000000000005',now()+interval '5 minutes');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"service@machine.test"}',true);
select public.worker_commit_sync('dddddddd-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000004','[{"id":"synthetic-auth-message","companyId":"dddddddd-0000-0000-0000-000000000001","dealId":"dddddddd-0000-0000-0000-000000000002","status":"matched","occurredAt":"2026-01-01T10:00:00Z"}]','{}',true);
select public.worker_commit_drive('dddddddd-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000005','[{"id":"synthetic-auth-file","name":"Synthetic evidence.txt","mimeType":"text/plain","version":"1","size":"1"}]','{}',true);
reset role;
select pg_temp.expect(exists(select 1 from public.interactions where deal_id='dddddddd-0000-0000-0000-000000000002' and created_by='publisher@machine.test'),'restricted publication uses leased member access');
select pg_temp.expect(exists(select 1 from public.documents where drive_file_id='synthetic-auth-file' and uploaded_by='publisher@machine.test'),'service Drive publication preserves original member ownership');
select pg_temp.expect(exists(select 1 from public.audit_log where entity_table='interactions' and actor_email='publisher@machine.test'),'service audit attributed to member, not service');
delete from public.deal_access_members where deal_id='dddddddd-0000-0000-0000-000000000002';
update public.crm_sync_jobs set status='running',lease='aaaaaaaa-0000-0000-0000-000000000005',locked_until=now()+interval '5 minutes' where id='dddddddd-0000-0000-0000-000000000005';
set local role authenticated;
select pg_temp.expect(pg_temp.denied($q$select public.worker_commit_drive('dddddddd-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000005','[]','{}',true)$q$),'revoked Deal access blocks service Drive commit');
select set_config('request.jwt.claims','{"role":"authenticated","email":"publisher@machine.test"}',true);
select public.disconnect_and_withdraw_sync();
reset role;
select pg_temp.expect(not exists(select 1 from public.documents where drive_file_id='synthetic-auth-file'),'withdrawal still works after Deal access revocation');
select pg_temp.expect(not exists(select 1 from public.interactions where deal_id='dddddddd-0000-0000-0000-000000000002'),'withdrawal removes only reviewed source publication');
rollback;

-- BEGIN GENERATED AUTH BUSINESS REGRESSIONS
-- Original business suite: durable_relationship_sync (synthetic Auth identity)
-- Synthetic only. Run after the full migration chain in a disposable DB.
begin;
insert into auth.users(id,email) values('aaaaaaaa-0000-0000-0000-000000000099','worker-service@machine.test');
insert into private.machine_identities(sub,relationships_only) values('aaaaaaaa-0000-0000-0000-000000000099',false);

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
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
insert into test_lease select id,lease,service from public.worker_claim_sync();
select pg_temp.expect((select service='gmail' from test_lease),'claim relationship-only Gmail');
select pg_temp.expect((public.worker_sync_context((select id from test_lease),(select lease from test_lease))->>'publishCrm')::boolean=false,'context denies CRM sink');
select pg_temp.expect(public.worker_sync_context((select id from test_lease),(select lease from test_lease))->'domains'='[]','relationship-only context has no Company resolution catalog');
select pg_temp.expect(not (public.worker_sync_context((select id from test_lease),(select lease from test_lease)) ? 'relationshipPeople'),'relationship-only context does not export unused People directory');
select pg_temp.expect(pg_temp.denied('select * from public.google_mailbox_connections'),'worker has no direct token table');
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),
 '[{"id":"m1","status":"ignored","occurredAt":"2026-09-01T10:00:00Z","subject":"Must not persist","relationshipParticipants":["contact@external.test"]},{"id":"m2","status":"ignored","occurredAt":"2026-09-01T15:00:00Z","relationshipParticipants":["CONTACT@external.test"]}]',
 '{"historyId":"checkpoint-1","mailboxAddress":"durable.one@example.test"}',true);
reset role;
select pg_temp.expect((select count(*)=1 and max(last_at)='2026-09-01T15:00:00Z' from public.relationship_interactions where member_email='durable.one@example.test'),'daily deduplication keeps latest');
select pg_temp.expect(not exists(select 1 from public.crm_source_events where email='durable.one@example.test'),'relationship-only never stores CRM subjects/events');
select pg_temp.expect((select count(*)=2 from private.relationship_source_contributions),'source provenance private');
update public.crm_sync_jobs set status='pending',completed_at=null where id=(select gmail from test_ids);
truncate test_lease;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
insert into test_lease select id,lease,service from public.worker_claim_sync();
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),
 '[{"id":"m1","status":"ignored","occurredAt":"2026-09-01T10:00:00Z","relationshipParticipants":["contact@external.test"]},{"id":"m2","status":"ignored","occurredAt":"2026-09-01T15:00:00Z","relationshipParticipants":["contact@external.test"]}]','{"historyId":"checkpoint-replay"}',true);
reset role;
select pg_temp.expect((select count(*)=2 from private.relationship_source_contributions),'replay does not duplicate provenance');
select pg_temp.expect((select count(*)=1 and max(last_at)='2026-09-01T15:00:00Z' from public.relationship_interactions where member_email='durable.one@example.test'),'replay cannot regress latest');

-- Existing history without provider IDs survives replacement/cancellation.
insert into private.relationship_legacy_history values('ab000000-0000-0000-0000-000000000001','durable.one@example.test','meeting','2026-09-02','2026-09-02T14:00:00Z');
update public.crm_sync_jobs set next_run_at=now() where id=(select calendar from test_ids);
truncate test_lease;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
insert into test_lease select id,lease,service from public.worker_claim_sync();
select public.worker_commit_sync((select id from test_lease),(select lease from test_lease),jsonb_build_array(
 jsonb_build_object('id','c1','status','ignored','occurredAt','2026-09-02T10:00:00Z','relationshipParticipants',jsonb_build_array('contact@external.test')),
 jsonb_build_object('id','c2','status','ignored','occurredAt','2026-09-02T15:00:00Z','relationshipParticipants',jsonb_build_array('contact@external.test')),
 jsonb_build_object('id','future','status','ignored','occurredAt',now()+interval '1 day','relationshipParticipants',jsonb_build_array('contact@external.test'))),'{"syncToken":"checkpoint-calendar"}',true);
reset role;
select pg_temp.expect((select count(*)=1 and max(last_at)='2026-09-02T15:00:00Z' from public.relationship_interactions where kind='meeting' and member_email='durable.one@example.test'),'future meeting not published');
-- Simulate time becoming due without Google reporting an event change.
update private.relationship_source_contributions set last_at='2026-09-03T12:00:00Z' where provider_id='future';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
select count(*) from public.worker_claim_sync();
reset role;
select pg_temp.expect(exists(select 1 from public.relationship_interactions where member_email='durable.one@example.test' and kind='meeting' and occurred_on='2026-09-03'),'scheduler publishes due meeting without changed cursor');
update public.crm_sync_jobs set status='pending',completed_at=null where id=(select calendar from test_ids);
truncate test_lease;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
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
truncate test_lease;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
insert into test_lease select id,lease,service from public.worker_claim_sync();
reset role;
update public.app_members set is_active=false where email='durable.one@example.test';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
select pg_temp.expect(pg_temp.denied(format('select public.worker_commit_sync(%L,%L,''[]'',''{}'',true)',(select id from test_lease),(select lease from test_lease))),'deactivated member lease cannot publish');
reset role;update public.app_members set is_active=true where email='durable.one@example.test';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"durable.one@example.test"}',true);
select public.configure_relationship_sync(false);
select pg_temp.expect(pg_temp.denied(format('select public.retry_crm_sync_job(%L)',(select gmail from test_ids))),'retry denied without either consent');
reset role;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
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
truncate test_lease;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
insert into test_lease select id,lease,service from public.worker_claim_sync();
select pg_temp.expect(not (public.worker_sync_context((select id from test_lease),(select lease from test_lease)) ? 'relationshipPeople'),'CRM context has no unused relationship directory');
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

-- Original business suite: crm_sync_jobs (synthetic Auth identity)
begin;
insert into auth.users(id,email) values('aaaaaaaa-0000-0000-0000-000000000099','worker-service@machine.test');
insert into private.machine_identities(sub,relationships_only) values('aaaaaaaa-0000-0000-0000-000000000099',false);

insert into public.app_members(email)values('worker.member@example.com');
insert into public.companies(id,name,last_activity_at)values('cccccccc-cccc-cccc-cccc-cccccccccccc','Sync Co','2026-01-01');
insert into public.google_mailbox_connections(email,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)values('worker.member@example.com','encrypted','iv','tag');
create function pg_temp.expect(ok boolean,label text)returns void language plpgsql as $$begin if not coalesce(ok,false)then raise exception 'SYNC TEST: %',label;end if;end$$;
create function pg_temp.refused(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when others then return true;end$$;
create temp table job(id uuid,lease uuid);grant all on job to authenticated,vanquish_worker;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"worker.member@example.com"}',true);
select public.configure_crm_sync(true,false);
select public.request_crm_sync();select public.request_crm_sync();
select pg_temp.expect((select count(*)from public.crm_sync_jobs)=2,'queue idempotent');
select pg_temp.expect(pg_temp.refused('select public.worker_claim_sync()'),'member cannot claim machine lease');
reset role;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
insert into job select id,lease from public.worker_claim_sync();
select pg_temp.expect(pg_temp.refused('select * from public.google_mailbox_connections'),'worker has no direct credential table access');
select pg_temp.expect(pg_temp.refused(format('select public.worker_sync_context(%L,%L)',(select id from job),gen_random_uuid())),'unowned lease denied');
select public.worker_commit_sync((select id from job),(select lease from job),jsonb_build_array(jsonb_build_object('id','provider-1','companyId','cccccccc-cccc-cccc-cccc-cccccccccccc','occurredAt','2026-09-01T12:00:00Z','subject','Private subject','status','matched')),'{"historyId":"10"}',true);
reset role;
select pg_temp.expect((select count(*)from public.interactions where source_event_id is not null)=1,'matched source published once');
select pg_temp.expect((select subject from public.interactions where source_event_id is not null) in ('Email activity','Calendar activity'),'subjects excluded without consent');
select pg_temp.expect((select last_activity_at from public.companies where id='cccccccc-cccc-cccc-cccc-cccccccccccc')='2026-09-01T12:00:00Z','activity updated');
-- Replay same source then cancellation in a fresh lease.
update public.crm_sync_jobs set status='pending',completed_at=null where id=(select id from job);
update public.crm_sync_jobs set next_run_at=now()+interval '1 hour' where id<>(select id from job);
truncate job;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
insert into job select id,lease from public.worker_claim_sync();
select public.worker_commit_sync((select id from job),(select lease from job),jsonb_build_array(jsonb_build_object('id','provider-1','status','deleted')),'{"historyId":"11"}',true);
reset role;
select pg_temp.expect((select count(*)from public.interactions where source_event_id is not null)=1,'cancellation keeps one historical record');
select pg_temp.expect((select count(*)from public.interactions where source_event_id is not null and archived_at is null)=0,'cancelled interaction archived');
select pg_temp.expect((select last_activity_at from public.companies where id='cccccccc-cccc-cccc-cccc-cccccccccccc')='2026-01-01','cancellation restores tracker baseline');
set local role authenticated;select set_config('request.jwt.claims','{"role":"authenticated","email":"worker.member@example.com"}',true);
select public.configure_crm_sync(false,false);
select pg_temp.expect((select count(*)from public.crm_sync_jobs where status='pending')=0,'opt out stops queued jobs');
reset role;set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
select pg_temp.expect(pg_temp.refused(format('select public.worker_commit_sync(%L,%L,''[]'',''{}'',true)',(select id from job),(select lease from job))),'opt out invalidates an existing lease');
reset role;rollback;

-- Original business suite: workflow_source_access (synthetic Auth identity)
begin;
insert into auth.users(id,email) values('aaaaaaaa-0000-0000-0000-000000000099','worker-service@machine.test');
insert into private.machine_identities(sub,relationships_only) values('aaaaaaaa-0000-0000-0000-000000000099',false);

insert into public.app_members(email) values('source.admin@example.com'),('source.reader@example.com'),('source.other@example.com');
insert into public.member_permissions(email,permission) values('source.admin@example.com','admin'),('source.admin@example.com','documents'),('source.admin@example.com','portfolio'),('source.reader@example.com','documents');
insert into public.companies(id,name) values('eeeeeeee-0000-0000-0000-000000000001','Source Company'),('eeeeeeee-0000-0000-0000-000000000002','Merge Company');
insert into public.deals(id,company_id,name,restricted,stage_id) values('eeeeeeee-0000-0000-0000-000000000003','eeeeeeee-0000-0000-0000-000000000001','Private round',true,(select id from public.pipeline_stages order by sort_order limit 1));
insert into public.deal_access_members(deal_id,member_email,access_role) values('eeeeeeee-0000-0000-0000-000000000003','source.reader@example.com','viewer');
insert into public.deal_assignees(deal_id,member_email,assigned_by) values('eeeeeeee-0000-0000-0000-000000000003','source.reader@example.com','source.admin@example.com');
insert into public.documents(id,company_id,deal_id,name,source,drive_file_id,entity_role) values('eeeeeeee-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000003','Evidence.pdf','drive_link','evidence','TARGET');
update public.documents set storage_path='source/private.pdf' where id='eeeeeeee-0000-0000-0000-000000000004';
insert into storage.objects(bucket_id,name) values('documents','source/private.pdf');
create function pg_temp.expect(ok boolean,label text)returns void language plpgsql as $$begin if not coalesce(ok,false)then raise exception 'SOURCE TEST: %',label;end if;end$$;
create function pg_temp.refused(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
create temp table ids(k text primary key,v uuid);grant all on ids to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"source.admin@example.com"}',true);
insert into ids values('document',public.comment_post_visible('documents',null,null,null,'document:eeeeeeee-0000-0000-0000-000000000004','Evidence',null,'Document note'));
insert into ids values('chat_allowed',public.chat_start_direct('source.reader@example.com'));
insert into ids values('chat_denied',public.chat_start_direct('source.other@example.com'));
select public.share_comment_to_chat((select v from ids where k='document'),(select v from ids where k='chat_allowed'));
select pg_temp.expect(pg_temp.refused(format('select public.share_comment_to_chat(%L,%L)',(select v from ids where k='document'),(select v from ids where k='chat_denied'))),'chat sharing rejects inaccessible recipients');
select pg_temp.expect((select count(*) from public.chat_messages where body like 'Workspace comment:%')=1,'chat receives source link only');
insert into ids values('deal',public.comment_post_visible('pipeline',null,null,null,'deal:eeeeeeee-0000-0000-0000-000000000003','Private round',null,'Pipeline note'));
insert into ids values('proposal',public.propose_change('eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000003','notes','Proposal','Evidence'));
select set_config('request.jwt.claims','{"role":"authenticated","email":"source.reader@example.com"}',true);
select pg_temp.expect((select count(*) from public.record_comments where id=(select v from ids where k='document'))=1,'document reader can read source discussion');
select pg_temp.expect(pg_temp.refused($q$select public.set_deal_assignee('eeeeeeee-0000-0000-0000-000000000003','source.reader@example.com',false)$q$),'reader cannot delete assignment via definer');
select pg_temp.expect(pg_temp.refused(format('select public.decide_change(%L,true)',(select v from ids where k='proposal'))),'reader cannot apply proposal via definer');
select set_config('request.jwt.claims','{"role":"authenticated","email":"source.other@example.com"}',true);
select pg_temp.expect((select count(*) from storage.objects where bucket_id='documents' and name='source/private.pdf')=0,'hidden document binary is not downloadable');
select pg_temp.expect((select count(*) from public.record_comments where id in(select v from ids))=0,'source comments honor deal and file permissions');
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('documents',null,null,null,'document:eeeeeeee-0000-0000-0000-000000000004','Guess',null,'Intrusion')$q$),'source mutation cannot bypass file permission');
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('pipeline',null,null,null,'deal:eeeeeeee-0000-0000-0000-000000000003','Guess',null,'Intrusion')$q$),'pipeline anchor cannot bypass deal permission');
select set_config('request.jwt.claims','{"role":"authenticated","email":"source.admin@example.com"}',true);
select pg_temp.expect(pg_temp.refused($q$select public.comment_post_context('documents',null,null,null,'document:eeeeeeee-0000-0000-0000-000000000004','Evidence',null,'Mention',array['source.other@example.com'])$q$),'mention cannot grant source access');
select public.merge_companies('eeeeeeee-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000002');
select pg_temp.expect((select merged_into_id from public.companies where id='eeeeeeee-0000-0000-0000-000000000002')='eeeeeeee-0000-0000-0000-000000000001','merge archives original identity with destination');
select public.configure_deal_access('eeeeeeee-0000-0000-0000-000000000003',true,'[]');
select set_config('request.jwt.claims','{"role":"authenticated","email":"source.reader@example.com"}',true);
select pg_temp.expect((select count(*) from public.record_comments where id=(select v from ids where k='document'))=0,'revoking deal access hides document discussion');
select pg_temp.expect((select count(*) from storage.objects where bucket_id='documents' and name='source/private.pdf')=0,'revoked document access also hides the binary');
with removed as (delete from storage.objects where bucket_id='documents' and name='source/private.pdf' returning id) select pg_temp.expect((select count(*) from removed)=0,'revoked reader cannot delete the binary');
reset role;
rollback;

-- Original business suite: withdraw_sync_publications (synthetic Auth identity)
begin;
insert into auth.users(id,email) values('aaaaaaaa-0000-0000-0000-000000000099','worker-service@machine.test');
insert into private.machine_identities(sub,relationships_only) values('aaaaaaaa-0000-0000-0000-000000000099',false);

create function pg_temp.expect(ok boolean,label text)returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'WITHDRAW TEST: %',label;end if;end$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
insert into public.app_members(email) values('withdraw.owner@example.com'),('withdraw.other@example.com'),('withdraw.admin@example.com');
insert into public.member_permissions(email,permission) values('withdraw.admin@example.com','admin'),('withdraw.admin@example.com','documents');
insert into public.companies(id,name,last_activity_at) values('11111111-1111-1111-1111-111111111111','Withdrawal fixture','2026-01-01');
insert into public.deals(id,company_id,name,restricted,stage_id) values('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Restricted round',true,(select id from public.pipeline_stages order by sort_order limit 1));
insert into public.people(id,name) values('33333333-3333-3333-3333-333333333333','Relationship fixture');
insert into public.google_mailbox_connections(email,refresh_token_encrypted,refresh_token_iv,refresh_token_tag) values('withdraw.owner@example.com','fixture','fixture','fixture'),('withdraw.other@example.com','fixture','fixture','fixture');
insert into public.crm_sync_accounts(email,enabled) values('withdraw.owner@example.com',true),('withdraw.other@example.com',true);
insert into public.crm_source_events(id,email,service,provider_id,company_id,deal_id,status,occurred_at) values('44444444-4444-4444-4444-444444444444','withdraw.owner@example.com','gmail','fixture','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','matched','2026-09-01');
select private.publish_source_event('44444444-4444-4444-4444-444444444444');
insert into public.relationship_interactions(person_id,member_email,kind,occurred_on,last_at) values('33333333-3333-3333-3333-333333333333','withdraw.owner@example.com','email','2026-09-01','2026-09-01'),('33333333-3333-3333-3333-333333333333','withdraw.other@example.com','email','2026-09-01','2026-09-01');
insert into public.drive_sources(id,email,folder_id,company_id,deal_id) values('55555555-5555-5555-5555-555555555555','withdraw.owner@example.com','fixture-folder','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
insert into public.crm_sync_jobs(id,email,service,drive_source_id,status,lease,locked_until) values('99999999-9999-9999-9999-999999999999','withdraw.owner@example.com','drive','55555555-5555-5555-5555-555555555555','running','66666666-6666-6666-6666-666666666666',now()+interval '5 minutes');
insert into public.documents(id,company_id,deal_id,name,source,drive_file_id,uploaded_by) values('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Owned Drive fixture','drive_link','fixture-file','withdraw.owner@example.com'),('88888888-8888-8888-8888-888888888888','11111111-1111-1111-1111-111111111111',null,'Other Drive fixture','drive_link','other-file','withdraw.other@example.com');
insert into public.document_analysis(document_id,expected_revision,extracted_text,extraction_status,confidence) values('77777777-7777-7777-7777-777777777777',1,'fixture text','extracted','review');
create temp table discussion(root uuid,reply uuid);grant all on discussion to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"withdraw.admin@example.com"}',true);
insert into discussion(root) select public.comment_post_context('documents',null,null,null,'document:77777777-7777-7777-7777-777777777777','Owned fixture',null,'Synthetic discussion');
update discussion set reply=public.comment_post_context('documents',null,null,root,'document:77777777-7777-7777-7777-777777777777','Owned fixture',null,'Synthetic reply');
reset role;
insert into public.tasks(company_id,deal_id,title,source_comment_id) select '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','Human follow-up fixture',reply from discussion;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"withdraw.other@example.com"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.disconnect_and_withdraw_sync('withdraw.owner@example.com')$q$),'other member cannot withdraw mine');
-- Own withdrawal succeeds even without Documents or access to the restricted
-- round that previously received their publication.
select set_config('request.jwt.claims','{"role":"authenticated","email":"withdraw.owner@example.com"}',true);
select public.disconnect_and_withdraw_sync();
select public.disconnect_and_withdraw_sync(); -- idempotent
reset role;
select pg_temp.expect(not exists(select 1 from public.google_mailbox_connections where email='withdraw.owner@example.com'),'stored token removed');
select pg_temp.expect(not exists(select 1 from public.crm_sync_accounts where email='withdraw.owner@example.com') and not exists(select 1 from public.crm_sync_jobs where email='withdraw.owner@example.com'),'consent, cursors and leases removed');
select pg_temp.expect(not exists(select 1 from public.crm_source_events where email='withdraw.owner@example.com') and not exists(select 1 from public.interactions where source_event_id='44444444-4444-4444-4444-444444444444'),'source and derived CRM interaction removed');
select pg_temp.expect(not exists(select 1 from public.relationship_interactions where member_email='withdraw.owner@example.com'),'relationship publication removed');
select pg_temp.expect(not exists(select 1 from public.drive_sources where email='withdraw.owner@example.com') and not exists(select 1 from public.documents where id='77777777-7777-7777-7777-777777777777') and not exists(select 1 from public.document_analysis where document_id='77777777-7777-7777-7777-777777777777') and not exists(select 1 from public.document_versions where document_id='77777777-7777-7777-7777-777777777777'),'Drive publications and derived analysis/versions removed');
select pg_temp.expect((select last_activity_at from public.companies where id='11111111-1111-1111-1111-111111111111')='2026-01-01','baseline restored');
select pg_temp.expect(exists(select 1 from public.google_mailbox_connections where email='withdraw.other@example.com') and exists(select 1 from public.documents where uploaded_by='withdraw.other@example.com') and exists(select 1 from public.relationship_interactions where member_email='withdraw.other@example.com'),'other member publications and token untouched');
select pg_temp.expect(exists(select 1 from public.audit_log where operation='DISCONNECT_AND_WITHDRAW' and actor_email='withdraw.owner@example.com' and after_row->>'member'='withdraw.owner@example.com'),'withdrawal audited without credentials');
select pg_temp.expect(not exists(select 1 from public.record_comments where id in(select root from discussion union select reply from discussion)),'source discussion and replies withdrawn');
select pg_temp.expect(exists(select 1 from public.tasks where title='Human follow-up fixture' and source_comment_id is null),'human follow-up remains with withdrawn source detached');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-0000-0000-0000-000000000099","email":"worker-service@machine.test"}',true);
select pg_temp.expect(pg_temp.denied($q$select public.worker_sync_context('99999999-9999-9999-9999-999999999999','66666666-6666-6666-6666-666666666666')$q$),'worker cannot read a withdrawn lease');
reset role;
select pg_temp.expect(not exists(select 1 from private.sync_withdrawal_context),'private capability cleaned up');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"withdraw.admin@example.com"}',true);
select public.disconnect_and_withdraw_sync('withdraw.other@example.com');
reset role;
select pg_temp.expect(not exists(select 1 from public.google_mailbox_connections where email='withdraw.other@example.com') and not exists(select 1 from public.documents where uploaded_by='withdraw.other@example.com'),'Admin may withdraw another member');
select pg_temp.expect(exists(select 1 from public.audit_log where operation='DISCONNECT_AND_WITHDRAW' and actor_email='withdraw.admin@example.com' and after_row->>'member'='withdraw.other@example.com'),'Admin delegation audited');
rollback;
