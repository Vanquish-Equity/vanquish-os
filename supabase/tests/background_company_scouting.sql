-- Disposable native PostgreSQL 16 only. All fixtures and writes roll back.
begin;

create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'COMPANY SCOUT TEST: %',label; end if; end$$;
create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'none'; exception when others then return sqlstate; end$$;
create function pg_temp.zero_or_denied(q text,label text) returns void language plpgsql as $$
declare n bigint;
begin
 begin execute q into n;
 exception when insufficient_privilege then return;
 end;
 perform pg_temp.expect(n=0,label);
end$$;
create function pg_temp.who(email text,sub uuid default null) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','email',email,'sub',sub)::text,true)
$$;
create function pg_temp.worker_denied() returns void language plpgsql as $$
begin
 perform pg_temp.expect(pg_temp.state('select public.worker_claim_company_scan()')='42501','worker claim requires registered identity');
 perform pg_temp.expect(pg_temp.state('select public.worker_company_scan_context(gen_random_uuid(),gen_random_uuid())')='42501','worker context requires registered identity');
 perform pg_temp.expect(pg_temp.state('select public.worker_commit_company_scan(gen_random_uuid(),gen_random_uuid(),''[]'',false)')='42501','worker commit requires registered identity');
 perform pg_temp.expect(pg_temp.state('select public.worker_fail_company_scan(gen_random_uuid(),gen_random_uuid(),''unavailable'')')='42501','worker fail requires registered identity');
end$$;
create function pg_temp.scan_rows(domain text) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('domain',domain,'suggestedName','Sample Company','threadCount',2,'twoWay',true,
   'firstSeen',now()-interval '1 day','lastSeen',now()-interval '1 hour','contacts','[]'::jsonb))
$$;
create temp table scout_leases(label text primary key,id uuid not null,lease uuid not null);
grant select,insert,update,delete on scout_leases to authenticated;
create function pg_temp.claim_worker(label text) returns void language sql as $$
 insert into scout_leases select label,(v->>'id')::uuid,(v->>'lease')::uuid from public.worker_claim_company_scan() q(v)
$$;
create function pg_temp.worker_context(label text) returns jsonb language sql as $$
 select public.worker_company_scan_context(id,lease) from scout_leases where scout_leases.label=$1
$$;
create function pg_temp.worker_commit(label text,p_rows jsonb) returns integer language sql as $$
 select public.worker_commit_company_scan(id,lease,$2,false) from scout_leases where scout_leases.label=$1
$$;

-- No member or machine is opted in by the migration; default behavior is off.
select pg_temp.expect((select column_default like '%false%' from information_schema.columns
 where table_schema='private' and table_name='machine_identities' and column_name='company_scanning_enabled'),'machine capability defaults false');
select pg_temp.expect((select count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='private' and c.relname in ('company_scout_accounts','company_scout_jobs') and c.relrowsecurity),'both new tables have RLS');
select pg_temp.expect((select count(*)=2 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='private' and c.relname in ('company_scout_accounts','company_scout_jobs') and p.polname='machine_identity_isolation'
 and not p.polpermissive and pg_get_expr(p.polqual,p.polrelid) like '%SELECT%is_machine_identity()%'
 and pg_get_expr(p.polwithcheck,p.polrelid) like '%SELECT%is_machine_identity()%'),'machine isolation uses both initplan predicates');

insert into public.app_members(email,display_name) values
 ('p4.owner@synthetic.test','Sample Owner'),('p4.other@synthetic.test','Sample Other'),
 ('p4.inactive@synthetic.test','Sample Inactive'),('p4.no-permission@synthetic.test','Sample Limited'),
 ('p4.no-connection@synthetic.test','Sample Disconnected');
update public.app_members set is_active=false where email='p4.inactive@synthetic.test';
insert into public.member_permissions(email,permission) values
 ('p4.owner@synthetic.test','email_scouting'),('p4.other@synthetic.test','email_scouting'),
 ('p4.inactive@synthetic.test','email_scouting'),('p4.no-connection@synthetic.test','email_scouting');
insert into public.google_mailbox_connections(email,granted_scopes,refresh_token_encrypted,refresh_token_iv,refresh_token_tag,updated_at)
select email,array['https://www.googleapis.com/auth/gmail.readonly'],'synthetic-cipher','synthetic-iv','synthetic-tag',now()-interval '1 day'
from public.app_members where email in ('p4.owner@synthetic.test','p4.other@synthetic.test','p4.inactive@synthetic.test','p4.no-permission@synthetic.test');
insert into auth.users(id,email) values
 ('e4000000-0000-4000-8000-000000000001','p4.worker@synthetic.test'),
 ('e4000000-0000-4000-8000-000000000002','p4.unregistered@synthetic.test'),
 ('e4000000-0000-4000-8000-000000000003','p4.second-worker@synthetic.test');
insert into private.machine_identities(sub) values('e4000000-0000-4000-8000-000000000001');
-- A real synthetic row makes the later machine/owner isolation checks non-vacuous.
insert into public.company_suggestions(member_email,domain,suggested_name,first_seen_at,last_seen_at)
values('p4.other@synthetic.test','baseline.synthetic.test','Sample Isolated Company',now(),now());

set local role anon;
do $$declare q text;begin
 foreach q in array array[
  'select public.my_company_scouting_state()',
  'select public.configure_company_scouting(false)',
  'select public.claim_my_company_scan()',
  'select public.my_company_scan_context(gen_random_uuid(),gen_random_uuid())',
  'select public.commit_my_company_scan(gen_random_uuid(),gen_random_uuid(),''[]'',false)',
  'select public.fail_my_company_scan(gen_random_uuid(),gen_random_uuid())',
  'select public.worker_claim_company_scan()',
  'select public.worker_company_scan_context(gen_random_uuid(),gen_random_uuid())',
  'select public.worker_commit_company_scan(gen_random_uuid(),gen_random_uuid(),''[]'',false)',
  'select public.worker_fail_company_scan(gen_random_uuid(),gen_random_uuid(),''unavailable'')'
 ] loop
  perform pg_temp.expect(pg_temp.state(q)='42501','anon API denied: '||q);
 end loop;
end$$;
reset role;
set local role authenticated;
select pg_temp.who('p4.not-member@synthetic.test');
select pg_temp.worker_denied();
select pg_temp.expect(pg_temp.state('select public.my_company_scouting_state()')='42501','nonmember state denied');
select pg_temp.expect(pg_temp.state('select public.configure_company_scouting(true)')='42501','nonmember consent denied');
select pg_temp.expect(pg_temp.state('select public.claim_my_company_scan()')='42501','nonmember manual claim denied');
select pg_temp.who('p4.inactive@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_company_scouting(true)')='42501','inactive member consent denied');
select pg_temp.expect(pg_temp.state('select public.claim_my_company_scan()')='42501','inactive member manual claim denied');
select pg_temp.who('p4.no-permission@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_company_scouting(true)')='42501','missing scouting permission denied');
select pg_temp.expect(pg_temp.state('select public.claim_my_company_scan()')='42501','missing permission cannot scan manually');
select pg_temp.who('p4.no-connection@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_company_scouting(true)')='42501','missing connection denied');
select pg_temp.who('p4.owner@synthetic.test');
select pg_temp.worker_denied();
select pg_temp.expect(public.my_company_scouting_state()->'enabled'='false'::jsonb,'background defaults off');
select pg_temp.expect(pg_temp.state('select public.configure_company_scouting(null)')='22023','null consent is invalid');
select public.configure_company_scouting(true);
select pg_temp.expect(public.my_company_scouting_state()->'enabled'='true'::jsonb,'owner explicitly opts in');
insert into scout_leases select 'manual',(v->>'id')::uuid,(v->>'lease')::uuid from public.claim_my_company_scan() q(v);
select pg_temp.expect((select count(*)=1 from scout_leases where label='manual'),'manual claim remains available');
select pg_temp.expect(not (public.my_company_scan_context((select id from scout_leases where label='manual'),(select lease from scout_leases where label='manual')) ? 'connection'),'manual context never returns encrypted credentials');
select pg_temp.expect((select count(*)=0 from public.claim_my_company_scan()),'second manual claim does not duplicate active lease');
select pg_temp.who('p4.other@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.my_company_scan_context((select id from scout_leases where label=''manual''),(select lease from scout_leases where label=''manual''))')='42501','another member cannot read context with stolen lease');
select pg_temp.expect(pg_temp.state('select public.commit_my_company_scan((select id from scout_leases where label=''manual''),(select lease from scout_leases where label=''manual''),''[]'',false)')='42501','another member cannot commit stolen lease');
select pg_temp.expect(pg_temp.state('select public.fail_my_company_scan((select id from scout_leases where label=''manual''),(select lease from scout_leases where label=''manual''))')='42501','another member cannot cancel stolen lease');
select pg_temp.who('p4.owner@synthetic.test');
select public.fail_my_company_scan((select id from scout_leases where label='manual'),(select lease from scout_leases where label='manual'));
reset role;
update private.company_scout_accounts set next_run_at=now() where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.who('p4.unregistered@synthetic.test','e4000000-0000-4000-8000-000000000002');
select pg_temp.worker_denied();
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'registered default identity has no company work');
select pg_temp.expect(pg_temp.state('select public.worker_company_scan_context(gen_random_uuid(),gen_random_uuid())')='42501','missing machine capability denies context');
select pg_temp.expect(pg_temp.state('select public.claim_my_company_scan()')='42501','machine cannot use member scan API');
reset role;
update private.machine_identities set company_scanning_enabled=true where sub='e4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'relationships-only mode still prevents company jobs');
select pg_temp.expect(pg_temp.state('select public.worker_company_scan_context(gen_random_uuid(),gen_random_uuid())')='42501','relationships-only mode denies context even with capability');
reset role;
update private.machine_identities set relationships_only=false,company_scanning_enabled=false where sub='e4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'capability alone blocks otherwise eligible work');
select pg_temp.expect(pg_temp.state('select public.worker_company_scan_context(gen_random_uuid(),gen_random_uuid())')='42501','capability required independently of relationships-only mode');
reset role;
update private.machine_identities set company_scanning_enabled=true where sub='e4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.who('p4.owner@synthetic.test');
delete from scout_leases where label='manual';
insert into scout_leases select 'manual',(v->>'id')::uuid,(v->>'lease')::uuid from public.claim_my_company_scan() q(v);
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'worker does not double claim manual lease');
select pg_temp.who('p4.owner@synthetic.test');
select public.fail_my_company_scan((select id from scout_leases where label='manual'),(select lease from scout_leases where label='manual'));
reset role;
update private.company_scout_accounts set next_run_at=now() where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.claim_worker('worker');
select pg_temp.expect((select count(*)=1 from scout_leases where label='worker'),'capable identity claims consenting owner');
select pg_temp.expect(pg_temp.worker_context('worker')->>'ownEmail'='p4.owner@synthetic.test','context bound to claimed owner');
select pg_temp.expect(pg_temp.worker_context('worker') ? 'connection','authorized worker context includes leased credentials');
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'second worker claim does not duplicate active lease');
reset role;
insert into private.machine_identities(sub,relationships_only,company_scanning_enabled)
values('e4000000-0000-4000-8000-000000000003',false,true);
set local role authenticated;
select pg_temp.who('p4.second-worker@synthetic.test','e4000000-0000-4000-8000-000000000003');
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''worker'')')='42501','another capable machine cannot read the first machine lease');
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''worker'',''[]'')')='42501','another capable machine cannot commit the first machine lease');
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.expect(pg_temp.state('select * from private.company_scout_accounts')='42501','machine cannot inspect scan accounts directly');
select pg_temp.expect(pg_temp.state('select * from private.company_scout_jobs')='42501','machine cannot inspect scan jobs directly');
select pg_temp.expect(pg_temp.state('insert into private.company_scout_accounts(email) values(''p4.worker@synthetic.test'')')='42501','machine cannot add scan accounts directly');
select pg_temp.expect((select count(*)=0 from public.app_members),'machine sees no member rows');
select pg_temp.expect((select count(*)=0 from public.company_suggestions),'machine sees no suggestions directly');
select pg_temp.zero_or_denied('select count(*) from public.google_mailbox_connections','machine sees no direct connection rows');
select pg_temp.expect(pg_temp.state('insert into public.company_suggestions(member_email,domain,suggested_name,first_seen_at,last_seen_at) values(''p4.owner@synthetic.test'',''forged.synthetic.test'',''Forged'',now(),now())')='42501','machine cannot bypass commit with direct suggestion insert');
select pg_temp.who('p4.owner@synthetic.test');
select pg_temp.expect((select count(*)=0 from public.claim_my_company_scan()),'manual scan does not double claim worker lease');
select pg_temp.expect(pg_temp.state('select public.my_company_scan_context((select id from scout_leases where label=''worker''),(select lease from scout_leases where label=''worker''))')='42501','member cannot use worker lease');
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.expect(pg_temp.worker_commit('worker',pg_temp.scan_rows('first.synthetic.test')||pg_temp.scan_rows('first.synthetic.test'))=1,'duplicate rows create one suggestion');
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''worker'',''[]'')')='42501','retry with consumed lease denied');
reset role;
select pg_temp.expect((select count(*)=1 from public.company_suggestions where member_email='p4.owner@synthetic.test' and domain='first.synthetic.test'),'exactly one owner suggestion stored');
select pg_temp.expect((select count(*)=1 and sum(company_suggestions_count)=1 from public.notifications where recipient_email='p4.owner@synthetic.test' and kind='company_suggestions_digest'),'worker inserts notify only leased owner once');
select pg_temp.expect((select count(*)=0 from public.notifications where recipient_email='p4.worker@synthetic.test'),'service user is never notification recipient');
set local role authenticated;
select pg_temp.who('p4.other@synthetic.test');
select pg_temp.expect((select count(*)=0 from public.notifications where recipient_email='p4.owner@synthetic.test'),'other member cannot see owner notice');
select pg_temp.expect((select count(*)=0 from public.company_suggestions where member_email='p4.owner@synthetic.test'),'other member cannot see owner suggestion');
select pg_temp.who('p4.owner@synthetic.test');
update public.company_suggestions set status='dismissed' where domain='first.synthetic.test';
update public.notifications set read_at=now() where kind='company_suggestions_digest';
reset role;
update private.company_scout_accounts set next_run_at=now() where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.claim_worker('repeat');
select pg_temp.expect(pg_temp.worker_commit('repeat',pg_temp.scan_rows('first.synthetic.test'))=0,'dismissed domain stays dismissed and adds no notice');
reset role;
select pg_temp.expect((select count(*)=1 and sum(company_suggestions_count)=1 and bool_and(read_at is not null) from public.notifications where recipient_email='p4.owner@synthetic.test' and kind='company_suggestions_digest'),'retrying dismissed domain does not alter digest');
select pg_temp.expect((select status='dismissed' from public.company_suggestions where member_email='p4.owner@synthetic.test' and domain='first.synthetic.test'),'dismissal never reopens');
update private.company_scout_accounts set next_run_at=now() where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.claim_worker('second');
select pg_temp.expect(pg_temp.worker_commit('second',pg_temp.scan_rows('second.synthetic.test'))=1,'second distinct suggestion inserted');
reset role;
select pg_temp.expect((select count(*)=1 and sum(company_suggestions_count)=2 and bool_and(read_at is null) from public.notifications where recipient_email='p4.owner@synthetic.test' and kind='company_suggestions_digest'),'new worker suggestion reopens only owner daily digest');

-- Revalidate each live boundary after a successful context read. No rejected
-- commit may publish a suggestion or increment its owner's daily notice.
update private.company_scout_accounts set next_run_at=now() where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.claim_worker('permission');
select pg_temp.worker_context('permission');
reset role;
delete from public.member_permissions where email='p4.owner@synthetic.test' and permission='email_scouting';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''permission'',pg_temp.scan_rows(''forbidden-permission.synthetic.test''))')='42501','permission revoked before commit denies publication');
reset role;
insert into public.member_permissions(email,permission) values('p4.owner@synthetic.test','email_scouting');
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''permission'')')='42501','regranting permission cannot revive an old lease');
reset role;

-- Clear this test's ephemeral lease as the owner-role fixture administrator.
delete from private.company_scout_jobs where email='p4.owner@synthetic.test';
update private.company_scout_accounts set next_run_at=now() where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.claim_worker('connection-update');
select pg_temp.worker_context('connection-update');
reset role;
update public.google_mailbox_connections set refresh_token_encrypted='synthetic-replacement-cipher' where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''connection-update'')')='42501','updating credentials fences old lease even within one transaction');
select pg_temp.claim_worker('connection');
select pg_temp.worker_context('connection');
reset role;
delete from public.google_mailbox_connections where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''connection'',pg_temp.scan_rows(''forbidden-connection.synthetic.test''))')='42501','connection revoked before commit denies publication');
reset role;
insert into public.google_mailbox_connections(email,granted_scopes,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)
values('p4.owner@synthetic.test',array['https://www.googleapis.com/auth/gmail.readonly'],'synthetic-cipher','synthetic-iv','synthetic-tag');
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''connection'')')='42501','reconnection cannot reuse previous connection lease');
select pg_temp.claim_worker('scope');
select pg_temp.worker_context('scope');
reset role;
update public.google_mailbox_connections set granted_scopes=array['https://www.googleapis.com/auth/calendar.readonly'] where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''scope'',pg_temp.scan_rows(''forbidden-scope.synthetic.test''))')='42501','revoked Gmail read scope denies in-flight publication');
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'missing Gmail scope excludes new background work');
reset role;
update public.google_mailbox_connections set granted_scopes=array['https://www.googleapis.com/auth/gmail.readonly'] where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''scope'')')='42501','scope regrant cannot revive old lease');
reset role;
delete from private.company_scout_jobs where email='p4.owner@synthetic.test';
update private.company_scout_accounts set next_run_at=now() where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.claim_worker('inactive-race');
select pg_temp.worker_context('inactive-race');
reset role;
update public.app_members set is_active=false where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''inactive-race'',pg_temp.scan_rows(''forbidden-inactive.synthetic.test''))')='42501','deactivated owner cannot publish in-flight scan');
reset role;
update public.app_members set is_active=true where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''inactive-race'')')='42501','reactivation cannot revive prior lease');
select pg_temp.claim_worker('consent');
select pg_temp.worker_context('consent');
select pg_temp.who('p4.owner@synthetic.test');
select public.configure_company_scouting(false);
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''consent'',pg_temp.scan_rows(''forbidden-consent.synthetic.test''))')='42501','withdrawn consent blocks in-flight publication');
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'withdrawn consent prevents new worker lease');
select pg_temp.who('p4.owner@synthetic.test');
select public.configure_company_scouting(true);
select pg_temp.who('p4.worker@synthetic.test','e4000000-0000-4000-8000-000000000001');
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''consent'')')='42501','reenabling consent never revives old lease');
select pg_temp.claim_worker('revoked-identity');
select pg_temp.worker_context('revoked-identity');
reset role;
update private.machine_identities set enabled=false where sub='e4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.worker_denied();
select pg_temp.expect(pg_temp.state('select pg_temp.worker_commit(''revoked-identity'',pg_temp.scan_rows(''forbidden-identity.synthetic.test''))')='42501','disabled machine cannot commit an acquired lease');
reset role;
update private.machine_identities set enabled=true where sub='e4000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''revoked-identity'')')='42501','reenabled machine cannot revive its old lease');
select pg_temp.claim_worker('expiring');
select pg_temp.worker_context('expiring');
reset role;
update private.company_scout_jobs set lease_until=now()-interval '1 minute' where email='p4.owner@synthetic.test';
set local role authenticated;
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''expiring'')')='42501','expired lease cannot expose context');
select pg_temp.expect(pg_temp.state('select public.worker_company_scan_context((select id from scout_leases where label=''expiring''),gen_random_uuid())')='42501','wrong lease token denied');
select pg_temp.claim_worker('fresh');
select pg_temp.expect((select count(*)=1 from scout_leases where label='fresh'),'expired job can be reclaimed once');
select pg_temp.expect(pg_temp.state('select pg_temp.worker_context(''expiring'')')='42501','rotated job id and token cannot reuse stale context');
select public.worker_fail_company_scan((select id from scout_leases where label='fresh'),(select lease from scout_leases where label='fresh'),'raw-provider-error');
reset role;
select pg_temp.expect((select last_error='unavailable' from private.company_scout_accounts where email='p4.owner@synthetic.test'),'failure checkpoint stores only bounded codes');
select pg_temp.expect((select count(*)=2 from public.company_suggestions where member_email='p4.owner@synthetic.test'),'rejected commits create no rows');
select pg_temp.expect((select count(*)=1 and sum(company_suggestions_count)=2 from public.notifications where recipient_email='p4.owner@synthetic.test' and kind='company_suggestions_digest'),'rejected commits create no extra notice');
select pg_temp.expect((select count(*)=1 and bool_and(domain='baseline.synthetic.test') from public.company_suggestions where member_email<>'p4.owner@synthetic.test' and domain like '%.synthetic.test'),'other member retains only its original isolated fixture');
set local role vanquish_worker;
select pg_temp.expect(pg_temp.state('select public.worker_claim_company_scan()')='42501','legacy worker role denied');
reset role;

-- Native guard mutation proof. The deliberate subtransaction rollback restores
-- the function, role and JWT before this synthetic fixture transaction ends.
do $$
declare original text; mutant text; caught boolean:=false;
begin
 select pg_get_functiondef('public.worker_claim_company_scan()'::regprocedure) into original;
 mutant:=regexp_replace(original,'perform private\.require_worker_identity\(\);','');
 perform pg_temp.expect(mutant<>original,'mutation removes the worker claim identity guard');
 begin
  execute mutant;
  execute 'set local role authenticated';
  perform pg_temp.who('p4.owner@synthetic.test');
  begin
   perform pg_temp.worker_denied();
   raise exception 'SQL identity mutant unexpectedly survived' using errcode='XX000';
  exception when raise_exception then
   if sqlerrm<>'COMPANY SCOUT TEST: worker claim requires registered identity' then raise; end if;
   caught:=true;
  end;
  raise exception 'Restore synthetic SQL mutation' using errcode='P4004';
 exception when sqlstate 'P4004' then null;
 end;
 perform pg_temp.expect(caught,'existing authorization assertion detects removed SQL guard');
 perform pg_temp.expect(pg_get_functiondef('public.worker_claim_company_scan()'::regprocedure)=original,'mutation rollback restores the exact function');
end$$;
set local role authenticated;
select pg_temp.who('p4.owner@synthetic.test');
select pg_temp.worker_denied();
reset role;

rollback;
