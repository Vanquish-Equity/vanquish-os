-- Native disposable PostgreSQL only. Mutations and fixtures roll back.
begin;

create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'P11 TEST: %',label; end if; end$$;
create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'ok'; exception when others then return sqlstate; end$$;
create function pg_temp.who(email text,sub uuid default null) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','email',email,'sub',sub)::text,true)
$$;
create function pg_temp.worker() returns void language sql as $$
 select pg_temp.who('p11.worker@synthetic.test','b1100000-0000-4000-8000-000000000001')
$$;
create function pg_temp.mutant(ddl text,assertion text,label text,guard text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin
    execute ddl;
    begin execute assertion;
    exception when raise_exception then
      if sqlerrm<>'P11 TEST: '||label then raise; end if;
      caught:=true;
    end;
    raise exception 'Restore P11 mutant' using errcode='P1100';
  exception when sqlstate 'P1100' then null;
  end;
  perform pg_temp.expect(caught,'mutant detected: '||guard);
  raise notice 'P11 mutant detected/restored: % -> %',guard,label;
end$$;
create function pg_temp.change_fn(sig text,needle text,replacement text,assertion text,label text,guard text) returns void language plpgsql as $$
declare original text:=pg_get_functiondef(sig::regprocedure); changed text;
begin
  changed:=replace(original,needle,replacement);
  perform pg_temp.expect(changed<>original,'guard found: '||guard);
  perform pg_temp.mutant(changed,assertion,label,guard);
  perform pg_temp.expect(pg_get_functiondef(sig::regprocedure)=original,'definition restored: '||guard);
end$$;

insert into public.app_members(email,display_name,is_active) values
 ('p11.owner@synthetic.test','Synthetic Owner',true),('p11.other@synthetic.test','Synthetic Other',true),
 ('p11.admin@synthetic.test','Synthetic Admin',true),('p11.worker@synthetic.test','Synthetic Worker',true),
 ('p11.inactive@synthetic.test','Synthetic Inactive',false),('p11.send-only@synthetic.test','Synthetic Send',true),
 ('p11.no-mailbox@synthetic.test','Synthetic No Mailbox',true);
insert into public.member_permissions(email,permission) values
 ('p11.owner@synthetic.test','email_scouting'),('p11.admin@synthetic.test','admin');
insert into public.google_mailbox_connections(email,granted_scopes,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)
select email,case when email='p11.send-only@synthetic.test' then array['https://www.googleapis.com/auth/gmail.send']
 else array['https://www.googleapis.com/auth/gmail.readonly'] end,'synthetic','synthetic','synthetic'
from public.app_members where email in ('p11.owner@synthetic.test','p11.other@synthetic.test','p11.inactive@synthetic.test','p11.send-only@synthetic.test');
insert into auth.users(id,email) values('b1100000-0000-4000-8000-000000000001','p11.worker@synthetic.test');
insert into private.machine_identities(sub,enabled,relationships_only,company_scanning_enabled,followup_scanning_enabled)
values('b1100000-0000-4000-8000-000000000001',true,false,true,true);

create function pg_temp.no_backfill() returns void language plpgsql as $$
begin
 perform pg_temp.who('p11.legacy-1@synthetic.test');
 perform pg_temp.expect(public.my_mail_headers_consent_state()->>'enabled'='false' and not exists(
   select 1 from private.mail_header_consent where member_email like 'p11.legacy-%' and enabled),
   'pre-migration flags did not authorize unified reading');
end$$;
select pg_temp.no_backfill();
select pg_temp.mutant(
 $q$insert into private.mail_header_consent(member_email,enabled)
 select email,true from private.company_scout_accounts where email like 'p11.legacy-%' and enabled$q$,
 'select pg_temp.no_backfill()','pre-migration flags did not authorize unified reading','auto-promote P4 legacy flags');
select pg_temp.mutant(
 $q$insert into private.mail_header_consent(member_email,enabled)
 select member_email,true from private.email_followup_accounts where member_email like 'p11.legacy-%' and enabled$q$,
 'select pg_temp.no_backfill()','pre-migration flags did not authorize unified reading','auto-promote P7 legacy flags');

create function pg_temp.default_off() returns void language plpgsql as $$
begin
 insert into private.mail_header_consent(member_email) values('p11.owner@synthetic.test');
 perform pg_temp.expect((select not enabled and enabled_at is null and last_error is null
   from private.mail_header_consent where member_email='p11.owner@synthetic.test'),'consent row defaults off');
end$$;
select pg_temp.mutant('alter table private.mail_header_consent alter column enabled set default true',
 'select pg_temp.default_off()','consent row defaults off','default false');
savepoint p11_default;
select pg_temp.default_off();
rollback to p11_default;

create function pg_temp.isolation() returns void language plpgsql as $$
begin
 perform pg_temp.expect((select relrowsecurity from pg_class where oid='private.mail_header_consent'::regclass),
   'consent table has RLS');
 perform pg_temp.expect(exists(select 1 from pg_policy where polrelid='private.mail_header_consent'::regclass
  and polname='machine_identity_isolation' and not polpermissive
  and pg_get_expr(polqual,polrelid) like '%SELECT%is_machine_identity()%'
  and pg_get_expr(polwithcheck,polrelid) like '%SELECT%is_machine_identity()%'),'restrictive machine isolation in both directions');
end$$;
select pg_temp.isolation();
select pg_temp.mutant('alter table private.mail_header_consent disable row level security',
 'select pg_temp.isolation()','consent table has RLS','RLS enabled');
select pg_temp.mutant('drop policy machine_identity_isolation on private.mail_header_consent',
 'select pg_temp.isolation()','restrictive machine isolation in both directions','machine identity isolation policy');
select pg_temp.mutant('grant select,update on private.mail_header_consent to authenticated',
 $q$select pg_temp.expect(not has_table_privilege('authenticated','private.mail_header_consent','select,update'),'no direct consent table grants')$q$,
 'no direct consent table grants','consent table grant fence');
select pg_temp.expect(not has_table_privilege('authenticated','private.mail_header_consent','select,insert,update,delete'),'no direct consent table grants');

set local role anon;
select pg_temp.expect(pg_temp.state('select public.my_mail_headers_consent_state()')='42501','anon state denied');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','anon configure denied');
select pg_temp.expect(pg_temp.state('select * from private.mail_header_consent')='42501','anon table denied');
reset role;
set local role authenticated;
select pg_temp.worker();
select pg_temp.expect(pg_temp.state('select public.my_mail_headers_consent_state()')='42501','registered machine cannot read member state even with a matching active member row');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(false)')='42501','registered machine cannot change consent');
select pg_temp.expect(pg_temp.state('select * from private.mail_header_consent')='42501','machine table denied');
select pg_temp.who('p11.inactive@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','inactive member denied');
select pg_temp.expect(pg_temp.state('select public.my_mail_headers_consent_state()')='42501','inactive state denied');
select pg_temp.who('p11.outsider@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','nonmember denied');
select pg_temp.who('p11.send-only@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','send-only scope denied');
select pg_temp.who('p11.no-mailbox@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','no mailbox denied');
select pg_temp.who('p11.owner@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(null)')='22023','null consent rejected');
select pg_temp.expect(pg_temp.state('select public.worker_claim_company_scan()')='42501','member cannot call P4 worker');
select pg_temp.expect(pg_temp.state('select public.worker_claim_email_followup()')='42501','member cannot call P7 worker');
reset role;

-- Simulate membership having been checked immediately before deactivation.
savepoint p11_recheck;
create or replace function private.require_member() returns text
language sql stable security definer set search_path='' as $$ select private.current_email() $$;
select pg_temp.who('p11.inactive@synthetic.test');
select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','inactive member denied after member check');
select pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',
 'perform 1 from public.app_members where email=me and is_active for no key update;',
 'perform 1 from public.app_members where email=me for no key update;',
 $q$select pg_temp.who('p11.inactive@synthetic.test'); select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','inactive member denied after member check')$q$,
 'inactive member denied after member check','live active-member recheck during configure');
rollback to p11_recheck;

select pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',
 'if p_enabled is null then raise exception ''Invalid consent'' using errcode=''22023''; end if;','',
 $q$select pg_temp.who('p11.owner@synthetic.test'); select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(null)')='22023','null consent rejected')$q$,
 'null consent rejected','explicit boolean consent');
select pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',
 'and private.email_followup_read_scope(granted_scopes) for share','for share',
 $q$select pg_temp.who('p11.send-only@synthetic.test'); select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','send-only scope denied')$q$,
 'send-only scope denied','Gmail read scope');
select pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',
 'if not found then raise exception ''Gmail reading is unavailable'' using errcode=''42501''; end if;','',
 $q$select pg_temp.who('p11.no-mailbox@synthetic.test'); select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(true)')='42501','no mailbox denied')$q$,
 'no mailbox denied','connected mailbox exists');
select pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',
 'me text:=private.require_member()','me text:=private.current_email()',
 $q$select pg_temp.worker(); select pg_temp.expect(pg_temp.state('select public.configure_mail_headers_consent(false)')='42501','machine configure denied')$q$,
 'machine configure denied','configure requires a human member');
select pg_temp.change_fn('public.my_mail_headers_consent_state()',
 'me text:=private.require_member()','me text:=private.current_email()',
 $q$select pg_temp.worker(); select pg_temp.expect(pg_temp.state('select public.my_mail_headers_consent_state()')='42501','machine state denied')$q$,
 'machine state denied','state requires a human member');
select pg_temp.mutant('grant execute on function public.configure_mail_headers_consent(boolean) to public',
 $q$select pg_temp.expect(not has_function_privilege('anon','public.configure_mail_headers_consent(boolean)','execute'),'anon cannot execute configure')$q$,
 'anon cannot execute configure','configure execute grant');
select pg_temp.mutant('grant execute on function public.my_mail_headers_consent_state() to public',
 $q$select pg_temp.expect(not has_function_privilege('anon','public.my_mail_headers_consent_state()','execute'),'anon cannot execute state')$q$,
 'anon cannot execute state','state execute grant');

-- A valid registered worker must not also be a human member.
delete from public.app_members where email='p11.worker@synthetic.test';

create function pg_temp.activate(owner_email text,want_company boolean) returns void language plpgsql as $$
declare s jsonb;
begin
 perform pg_temp.who(owner_email);
 perform public.configure_mail_headers_consent(true);
 s:=public.my_mail_headers_consent_state();
 perform pg_temp.expect((s->>'enabled')::boolean and (s->>'canRead')::boolean and (s#>>'{followup,enabled}')::boolean
  and (s#>>'{company,permitted}')::boolean=want_company
  and (s#>>'{company,enabled}')::boolean=want_company,'features follow consent and company permission');
 perform pg_temp.expect((select enabled and enabled_at is not null and last_error is null
  from private.mail_header_consent where member_email=owner_email),'consent timestamp set');
end$$;
select pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',
 'p_enabled and company_allowed','p_enabled',
 $q$select pg_temp.activate('p11.other@synthetic.test',false)$q$,
 'features follow consent and company permission','scouting permission remains separate');
savepoint p11_limited;
select pg_temp.activate('p11.other@synthetic.test',false);
rollback to p11_limited;

-- With capable identities present, old RPCs may set flags but still yield no background work.
set local role authenticated;
select pg_temp.who('p11.legacy-1@synthetic.test');
select public.configure_company_scouting(false);
select public.configure_email_followup(false);
select pg_temp.expect(public.my_company_scouting_state()->>'enabled'='false'
 and public.my_email_followup_state()->>'enabled'='false','old settings can disable in the deployment gap');
select public.configure_company_scouting(true);
select public.configure_email_followup(true);
select pg_temp.expect(public.my_company_scouting_state()->>'enabled'='true'
 and public.my_email_followup_state()->>'enabled'='true'
 and public.my_mail_headers_consent_state()->>'enabled'='false','old settings can save but do not authorize unified reading');
select pg_temp.worker();
select pg_temp.expect((select count(*)=0 from public.worker_claim_company_scan()),'legacy P4 cannot claim');
select pg_temp.expect((select count(*)=0 from public.worker_claim_email_followup()),'legacy P7 cannot claim');
reset role;
update private.company_scout_accounts set next_run_at='-infinity' where email like 'p11.legacy-%';
update private.email_followup_accounts set next_run_at='-infinity' where member_email like 'p11.legacy-%';

-- Manual P4 is a one-time action, not the scheduled worker.
set local role authenticated;
select pg_temp.who('p11.owner@synthetic.test');
do $$declare j jsonb;begin
 select * into j from public.claim_my_company_scan();
 perform pg_temp.expect(j is not null and not(public.my_company_scan_context((j->>'id')::uuid,(j->>'lease')::uuid) ? 'connection'),
  'manual scan works without unified consent and never returns worker credentials');
 perform public.fail_my_company_scan((j->>'id')::uuid,(j->>'lease')::uuid);
end$$;
reset role;

select pg_temp.activate('p11.owner@synthetic.test',true);
create function pg_temp.own_state_only(viewer text) returns void language plpgsql as $$
begin
 perform pg_temp.who(viewer);
 perform pg_temp.expect(public.my_mail_headers_consent_state()->>'enabled'='false','state is scoped to caller even for an admin');
 perform public.configure_mail_headers_consent(false);
 perform pg_temp.expect((select enabled from private.mail_header_consent where member_email='p11.owner@synthetic.test'),
  'configure cannot change another member');
end$$;
select pg_temp.change_fn('public.my_mail_headers_consent_state()',
 'where member_email=me;', $q$where member_email='p11.owner@synthetic.test';$q$,
 $q$select pg_temp.own_state_only('p11.admin@synthetic.test')$q$,
 'state is scoped to caller even for an admin','read uses own member identity');
select pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',
 'values(me,p_enabled,case when p_enabled then now() end)', $q$values('p11.owner@synthetic.test',p_enabled,case when p_enabled then now() end)$q$,
 $q$select pg_temp.own_state_only('p11.other@synthetic.test')$q$,
 'configure cannot change another member','write uses own member identity');
select pg_temp.own_state_only('p11.other@synthetic.test');
select pg_temp.own_state_only('p11.admin@synthetic.test');

set local role authenticated;
select pg_temp.who('p11.admin@synthetic.test');
select pg_temp.expect(pg_temp.state('update private.mail_header_consent set enabled=false')='42501','admin cannot write table');
select pg_temp.expect(pg_temp.state('select * from private.mail_header_consent')='42501','admin cannot read table');
select pg_temp.who('p11.other@synthetic.test');
select pg_temp.expect(pg_temp.state('select * from private.mail_header_consent')='42501','member cannot read table');
reset role;

create function pg_temp.claim_for_owner(kind text) returns void language plpgsql as $$
declare j jsonb; actual_owner text;
begin
 perform pg_temp.worker();
 if kind='P4' then
   select * into j from public.worker_claim_company_scan();
   select email into actual_owner from private.company_scout_jobs where id=(j->>'id')::uuid;
 else
   select * into j from public.worker_claim_email_followup();
   select member_email into actual_owner from private.email_followup_jobs where id=(j->>'id')::uuid;
 end if;
 perform pg_temp.expect(actual_owner='p11.owner@synthetic.test',kind||' skips legacy flags and claims eligible owner');
end$$;
select pg_temp.change_fn('public.worker_claim_company_scan()',
 'join private.mail_header_consent u on u.member_email=s.email and u.enabled','',
 $q$select pg_temp.claim_for_owner('P4')$q$,'P4 skips legacy flags and claims eligible owner','P4 claim filters unified consent before budget');
select pg_temp.change_fn('public.worker_claim_email_followup()',
 'join private.mail_header_consent u on u.member_email=s.member_email and u.enabled','',
 $q$select pg_temp.claim_for_owner('P7')$q$,'P7 skips legacy flags and claims eligible owner','P7 claim filters unified consent before budget');
select pg_temp.claim_for_owner('P4');
select pg_temp.claim_for_owner('P7');

create function pg_temp.lease_access(kind text,action text) returns text language plpgsql as $$
declare id uuid; lease uuid;
begin
 if kind='P4' then
   select j.id,j.lease into strict id,lease from private.company_scout_jobs j where email='p11.owner@synthetic.test';
   if action='context' then perform public.worker_company_scan_context(id,lease);
   elsif action='commit' then perform public.worker_commit_company_scan(id,lease,'[]',false);
   else perform public.worker_fail_company_scan(id,lease,'unavailable'); end if;
 else
   select j.id,j.lease into strict id,lease from private.email_followup_jobs j where member_email='p11.owner@synthetic.test';
   if action='context' then perform public.worker_email_followup_context(id,lease);
   elsif action='commit' then perform public.worker_commit_email_followup(id,lease,'[]');
   else perform public.worker_fail_email_followup(id,lease,'unavailable'); end if;
 end if;
 return 'ok';
exception when insufficient_privilege then return sqlstate;
end$$;
create temp table p11_stolen as
  select 'P4' kind,id,lease from private.company_scout_jobs where email='p11.owner@synthetic.test'
  union all select 'P7',id,lease from private.email_followup_jobs where member_email='p11.owner@synthetic.test';
grant select on p11_stolen to authenticated;
set local role authenticated;
select pg_temp.who('p11.other@synthetic.test');
select pg_temp.expect(pg_temp.state($q$select public.worker_company_scan_context(id,lease) from p11_stolen where kind='P4'$q$)='42501','member cannot use P4 worker context');
select pg_temp.expect(pg_temp.state($q$select public.worker_commit_company_scan(id,lease,'[]',false) from p11_stolen where kind='P4'$q$)='42501','member cannot use P4 worker commit');
select pg_temp.expect(pg_temp.state($q$select public.worker_email_followup_context(id,lease) from p11_stolen where kind='P7'$q$)='42501','member cannot use P7 worker context');
select pg_temp.expect(pg_temp.state($q$select public.worker_commit_email_followup(id,lease,'[]') from p11_stolen where kind='P7'$q$)='42501','member cannot use P7 worker commit');
reset role;
select pg_temp.worker();
select pg_temp.expect(pg_temp.lease_access('P4','context')='ok' and pg_temp.lease_access('P7','context')='ok',
 'authorized worker can read both contexts');

savepoint p11_stale_lease;
-- Remove only the unified permission. Keep both feature flags and both genuine,
-- current lease generations intact to isolate the shared worker guard.
update private.mail_header_consent set enabled=false where member_email='p11.owner@synthetic.test';
do $$declare kind text; act text; sig text; guard text; label text;begin
 foreach kind in array array['P4','P7'] loop
   if kind='P4' then
     sig:='private.require_company_scout_account(text,boolean)';
     guard:='perform 1 from private.mail_header_consent where member_email=p_email and enabled for share;';
   else
     sig:='private.require_email_followup_job(uuid,uuid)';
     guard:='perform 1 from private.mail_header_consent where member_email=owner_email and enabled for share;';
   end if;
   foreach act in array array['context','commit','fail'] loop
     label:=kind||' '||act||' requires unified consent with a live lease';
     perform pg_temp.expect(pg_temp.lease_access(kind,act)='42501',label);
     perform pg_temp.change_fn(sig,guard,'perform 1;',
       format('select pg_temp.expect(pg_temp.lease_access(%L,%L)=''42501'',%L)',kind,act,label),label,kind||' '||act||' unified guard');
   end loop;
 end loop;
end$$;
rollback to p11_stale_lease;

-- A unified grant is necessary, not sufficient. Leave genuine leases in
-- place to test the independent internal account authorization.
savepoint p11_internal_flags;
update private.company_scout_accounts set enabled=false where email='p11.owner@synthetic.test';
update private.email_followup_accounts set enabled=false where member_email='p11.owner@synthetic.test';
select pg_temp.expect(pg_temp.lease_access('P4','context')='42501','P4 internal flag still required');
select pg_temp.expect(pg_temp.lease_access('P7','context')='42501','P7 internal flag still required');
select pg_temp.change_fn('private.require_company_scout_job(uuid,uuid,boolean)',
 'and (not p_worker or enabled) for update','for update',
 $q$select pg_temp.expect(pg_temp.lease_access('P4','context')='42501','P4 internal flag still required')$q$,
 'P4 internal flag still required','P4 still checks the separate internal flag');
select pg_temp.change_fn('private.require_email_followup_job(uuid,uuid)',
 'where member_email=owner_email and enabled for update','where member_email=owner_email for update',
 $q$select pg_temp.expect(pg_temp.lease_access('P7','context')='42501','P7 internal flag still required')$q$,
 'P7 internal flag still required','P7 still checks the separate internal flag');
rollback to p11_internal_flags;

savepoint p11_positive_commits;
select pg_temp.expect(pg_temp.lease_access('P4','commit')='ok' and pg_temp.lease_access('P7','commit')='ok',
 'authorized workers can still checkpoint both features');
rollback to p11_positive_commits;

-- Old endpoints cannot re-enable either internal flag after P11 consent.
create function pg_temp.legacy_cannot_override(kind text) returns void language plpgsql as $$
begin
 perform pg_temp.who('p11.owner@synthetic.test');
 perform public.configure_mail_headers_consent(false);
 if kind='P4' then perform public.configure_company_scouting(true);
 else perform public.configure_email_followup(true); end if;
 perform pg_temp.expect((select not enabled from private.company_scout_accounts where email='p11.owner@synthetic.test')
   and (select not enabled from private.email_followup_accounts where member_email='p11.owner@synthetic.test'),
  kind||' legacy RPC cannot override unified choice');
end$$;
do $$declare kind text; sig text; label text;begin
 foreach kind in array array['P4','P7'] loop
   sig:=case kind when 'P4' then 'public.configure_company_scouting(boolean)' else 'public.configure_email_followup(boolean)' end;
   label:=kind||' legacy RPC cannot override unified choice';
   perform pg_temp.change_fn(sig,'if exists(select 1 from private.mail_header_consent where member_email=me for share) then return; end if;','',
     format('select pg_temp.legacy_cannot_override(%L)',kind),label,kind||' legacy RPC guard');
 end loop;
end$$;
savepoint p11_legacy_override;
select pg_temp.legacy_cannot_override('P4');
select pg_temp.legacy_cannot_override('P7');
rollback to p11_legacy_override;

insert into public.people(id,name) values('b1100000-0000-4000-8000-000000000002','Synthetic Contact');
insert into public.company_suggestions(member_email,domain,suggested_name,first_seen_at,last_seen_at)
values('p11.owner@synthetic.test','p11-company.synthetic.test','Synthetic Company',now(),now());
insert into public.contact_reminders(id,person_id,title,due_on,visibility,created_by,email_followup_private)
values('b1100000-0000-4000-8000-000000000003','b1100000-0000-4000-8000-000000000002','Synthetic reminder',current_date,'private','p11.owner@synthetic.test',true);
insert into private.email_followups(member_email,thread_id,last_inbound_at,last_inbound_message_id,status,reminder_id)
values('p11.owner@synthetic.test','synthetic-thread',now()-interval '7 days','synthetic-message','pending','b1100000-0000-4000-8000-000000000003');
insert into public.relationship_sync(member_email,enabled) values('p11.owner@synthetic.test',true);
insert into public.relationship_interactions(person_id,member_email,kind,occurred_on,last_at)
values('b1100000-0000-4000-8000-000000000002','p11.owner@synthetic.test','email',current_date,now());

create function pg_temp.withdrawal() returns void language plpgsql as $$
declare old_u uuid; old_c uuid; old_f uuid;
begin
 select generation into old_u from private.mail_header_consent where member_email='p11.owner@synthetic.test';
 select generation into old_c from private.company_scout_accounts where email='p11.owner@synthetic.test';
 select generation into old_f from private.email_followup_accounts where member_email='p11.owner@synthetic.test';
 perform pg_temp.who('p11.owner@synthetic.test');
 perform public.configure_mail_headers_consent(false);
 perform pg_temp.expect((select not enabled and generation<>old_u from private.mail_header_consent where member_email='p11.owner@synthetic.test')
   and (select not enabled and generation<>old_c from private.company_scout_accounts where email='p11.owner@synthetic.test')
   and (select not enabled and generation<>old_f from private.email_followup_accounts where member_email='p11.owner@synthetic.test'),
   'withdrawal disables and rotates all three generations');
 perform pg_temp.expect(not exists(select 1 from private.company_scout_jobs where email='p11.owner@synthetic.test')
   and not exists(select 1 from private.email_followup_jobs where member_email='p11.owner@synthetic.test'),
   'withdrawal removes both active leases');
 perform pg_temp.expect(exists(select 1 from public.company_suggestions where domain='p11-company.synthetic.test')
   and exists(select 1 from public.contact_reminders where id='b1100000-0000-4000-8000-000000000003' and completed_at is null)
   and exists(select 1 from private.email_followups where thread_id='synthetic-thread')
   and exists(select 1 from public.relationship_interactions where member_email='p11.owner@synthetic.test')
   and exists(select 1 from public.relationship_sync where member_email='p11.owner@synthetic.test' and enabled),
   'withdrawal preserves suggestions reminders ledger and separate relationship history');
end$$;
do $$declare needle text; replacement text; label text; guard text;begin
 for needle,replacement,label,guard in select * from (values
  ('generation=gen_random_uuid(),last_error=null','generation=private.mail_header_consent.generation,last_error=null',
    'withdrawal disables and rotates all three generations','unified generation rotation'),
  ('set enabled=excluded.enabled,generation=gen_random_uuid(),','set enabled=excluded.enabled,',
    'withdrawal disables and rotates all three generations','P4/P7 internal generation rotation'),
  ('delete from private.company_scout_jobs where email=me;','',
    'withdrawal removes both active leases','withdrawal invalidates P4 lease'),
  ('delete from private.email_followup_jobs where member_email=me;','',
    'withdrawal removes both active leases','withdrawal invalidates P7 lease'),
  ('delete from private.company_scout_jobs where email=me;','delete from private.company_scout_jobs where email=me; delete from public.company_suggestions where member_email=me;',
    'withdrawal preserves suggestions reminders ledger and separate relationship history','withdrawal must not delete suggestions'),
  ('delete from private.company_scout_jobs where email=me;','delete from private.company_scout_jobs where email=me; delete from public.contact_reminders where created_by=me;',
    'withdrawal preserves suggestions reminders ledger and separate relationship history','withdrawal must not delete reminders'),
  ('delete from private.company_scout_jobs where email=me;','delete from private.company_scout_jobs where email=me; delete from public.relationship_interactions where member_email=me;',
    'withdrawal preserves suggestions reminders ledger and separate relationship history','withdrawal must not delete relationship history')
 ) g(n,r,l,d) loop
  perform pg_temp.change_fn('public.configure_mail_headers_consent(boolean)',needle,replacement,'select pg_temp.withdrawal()',label,guard);
 end loop;
end$$;
savepoint p11_withdrawal;
select pg_temp.withdrawal();
rollback to p11_withdrawal;

create function pg_temp.revocation(kind text) returns void language plpgsql as $$
declare saved public.google_mailbox_connections; u uuid; c uuid; f uuid;
begin
 select * into saved from public.google_mailbox_connections where email='p11.owner@synthetic.test';
 select generation into u from private.mail_header_consent where member_email=saved.email;
 select generation into c from private.company_scout_accounts where email=saved.email;
 select generation into f from private.email_followup_accounts where member_email=saved.email;
 case kind
  when 'disconnect' then delete from public.google_mailbox_connections where email=saved.email;
  when 'mailbox-owner' then update public.google_mailbox_connections set email='p11.no-mailbox@synthetic.test' where email=saved.email;
  when 'cipher' then update public.google_mailbox_connections set refresh_token_encrypted='synthetic-replaced' where email=saved.email;
  when 'iv' then update public.google_mailbox_connections set refresh_token_iv='synthetic-replaced' where email=saved.email;
  when 'tag' then update public.google_mailbox_connections set refresh_token_tag='synthetic-replaced' where email=saved.email;
  when 'scope' then update public.google_mailbox_connections set granted_scopes=array['https://www.googleapis.com/auth/gmail.send'] where email=saved.email;
  when 'member' then update public.app_members set is_active=false where email=saved.email;
  when 'permission-delete' then delete from public.member_permissions where email=saved.email and permission='email_scouting';
  when 'permission-update' then update public.member_permissions set permission='admin' where email=saved.email and permission='email_scouting';
 end case;
 perform pg_temp.expect((select not enabled and enabled_at is null and last_error='revoked' and generation<>u
   from private.mail_header_consent where member_email=saved.email),'event revokes unified consent: '||kind);
 perform pg_temp.expect((select not enabled and last_error is null and generation<>c from private.company_scout_accounts where email=saved.email)
  and (select not enabled and last_error is null and generation<>f from private.email_followup_accounts where member_email=saved.email)
  and not exists(select 1 from private.company_scout_jobs where email=saved.email)
  and not exists(select 1 from private.email_followup_jobs where member_email=saved.email),
  'event revokes both features and leases: '||kind);
 case kind
  when 'disconnect' then insert into public.google_mailbox_connections select saved.*;
  when 'mailbox-owner' then update public.google_mailbox_connections set email=saved.email where email='p11.no-mailbox@synthetic.test';
  when 'cipher' then update public.google_mailbox_connections set refresh_token_encrypted=saved.refresh_token_encrypted where email=saved.email;
  when 'iv' then update public.google_mailbox_connections set refresh_token_iv=saved.refresh_token_iv where email=saved.email;
  when 'tag' then update public.google_mailbox_connections set refresh_token_tag=saved.refresh_token_tag where email=saved.email;
  when 'scope' then update public.google_mailbox_connections set granted_scopes=saved.granted_scopes where email=saved.email;
  when 'member' then update public.app_members set is_active=true where email=saved.email;
  when 'permission-delete' then insert into public.member_permissions(email,permission) values(saved.email,'email_scouting');
  when 'permission-update' then update public.member_permissions set permission='email_scouting' where email=saved.email and permission='admin';
 end case;
 perform pg_temp.who(saved.email);
 perform pg_temp.expect(public.my_mail_headers_consent_state()->>'enabled'='false'
   and public.my_mail_headers_consent_state()->>'lastError'='revoked',
   'restoring access never opts in: '||kind);
end$$;

do $$declare kind text; needle text; replacement text; label text;begin
 for kind,needle,replacement in select * from (values
  ('disconnect','if tg_op=''DELETE'' then'||chr(10)||'      withdraw:=true;', 'if tg_op=''DELETE'' then'||chr(10)||'      withdraw:=false;'),
  ('mailbox-owner','new.email is distinct from old.email','false'),
  ('cipher','or new.refresh_token_encrypted is distinct from old.refresh_token_encrypted',''),
  ('iv','or new.refresh_token_iv is distinct from old.refresh_token_iv',''),
  ('tag','or new.refresh_token_tag is distinct from old.refresh_token_tag',''),
  ('scope','or not private.email_followup_read_scope(new.granted_scopes)',''),
  ('member','member:=new.email;'||chr(10)||'    withdraw:=true;','member:=new.email;'||chr(10)||'    withdraw:=false;'),
  ('permission-delete','member:=old.email;'||chr(10)||'    withdraw:=true;','member:=old.email;'||chr(10)||'    withdraw:=false;'),
  ('permission-update','member:=old.email;'||chr(10)||'    withdraw:=true;','member:=old.email;'||chr(10)||'    withdraw:=false;')
 ) t(k,n,r) loop
   begin
     perform pg_temp.revocation(kind);
     raise exception 'Restore event fixture' using errcode='P1101';
   exception when sqlstate 'P1101' then null;
   end;
   label:='event revokes unified consent: '||kind;
   perform pg_temp.change_fn('private.fence_mail_headers_consent()',needle,replacement,
     format('select pg_temp.revocation(%L)',kind),label,'revocation on '||kind);
 end loop;
end$$;

create function pg_temp.non_revoking_event() returns void language plpgsql as $$
begin
 insert into public.member_permissions(email,permission) values('p11.owner@synthetic.test','admin');
 delete from public.member_permissions where email='p11.owner@synthetic.test' and permission='admin';
 perform pg_temp.expect((select enabled from private.mail_header_consent where member_email='p11.owner@synthetic.test')
   and exists(select 1 from private.company_scout_jobs where email='p11.owner@synthetic.test')
   and exists(select 1 from private.email_followup_jobs where member_email='p11.owner@synthetic.test'),
   'unrelated permissions do not revoke consent or leases');
 update public.google_mailbox_connections set updated_at=now()+interval '1 second' where email='p11.owner@synthetic.test';
 perform pg_temp.expect((select enabled and last_error is null from private.mail_header_consent where member_email='p11.owner@synthetic.test')
   and not exists(select 1 from private.company_scout_jobs where email='p11.owner@synthetic.test')
   and not exists(select 1 from private.email_followup_jobs where member_email='p11.owner@synthetic.test'),
   'connection version changes invalidate both leases without revoking');
end$$;
select pg_temp.change_fn('private.fence_mail_headers_consent()', 'old.permission<>''email_scouting'' or ','',
 'select pg_temp.non_revoking_event()','unrelated permissions do not revoke consent or leases','ignore unrelated permission changes');
savepoint p11_harmless;
select pg_temp.non_revoking_event();
rollback to p11_harmless;

-- Exercise the restrictive policy under temporary grants and a permissive
-- policy: otherwise a missing policy would be masked by the correct ACL.
savepoint p11_rls_runtime;
grant usage on schema private to authenticated;
grant select,insert on private.mail_header_consent to authenticated;
create policy p11_test_permissive on private.mail_header_consent for all to authenticated using (true) with check (true);
create function pg_temp.machine_policy(op text) returns void language plpgsql as $$
declare allowed boolean;
begin
 perform pg_temp.worker();
 set local role authenticated;
 if op='read' then
   allowed:=exists(select 1 from private.mail_header_consent where member_email='p11.owner@synthetic.test');
 else
   allowed:=pg_temp.state($q$insert into private.mail_header_consent(member_email) values('p11.no-mailbox@synthetic.test')$q$)='ok';
 end if;
 reset role;
 perform pg_temp.expect(not allowed,'machine policy denies '||op||' despite an accidental grant');
end$$;
select pg_temp.machine_policy('read');
select pg_temp.machine_policy('insert');
select pg_temp.mutant('alter policy machine_identity_isolation on private.mail_header_consent using (true)',
 $q$select pg_temp.machine_policy('read')$q$,'machine policy denies read despite an accidental grant','restrictive machine read predicate');
select pg_temp.mutant('alter policy machine_identity_isolation on private.mail_header_consent with check (true)',
 $q$select pg_temp.machine_policy('insert')$q$,'machine policy denies insert despite an accidental grant','restrictive machine write predicate');
rollback to p11_rls_runtime;

-- Structural lock checks accompany the behavioral stale-lease cases.
create function pg_temp.shared_lock(sig text,fragment text,label text) returns void language plpgsql as $$
begin perform pg_temp.expect(strpos(pg_get_functiondef(sig::regprocedure),fragment)>0,label); end$$;
do $$declare sig text; filter text; fragment text; label text;begin
 for sig,filter in select * from (values
  ('private.require_company_scout_account(text,boolean)','p_email'),
  ('private.require_email_followup_job(uuid,uuid)','owner_email'),
  ('public.worker_claim_email_followup()','candidate')
 ) t(s,f) loop
   fragment:='from private.mail_header_consent where member_email='||filter||' and enabled for share';
   label:='unified row is locked for '||filter;
   perform pg_temp.shared_lock(sig,fragment,label);
   perform pg_temp.change_fn(sig,fragment,replace(fragment,' for share',''),
     format('select pg_temp.shared_lock(%L,%L,%L)',sig,fragment,label),label,'shared consent row lock in '||sig);
 end loop;
end$$;

rollback;
