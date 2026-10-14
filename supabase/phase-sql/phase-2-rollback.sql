-- Full Phase 2 schema rollback; refuses durable financial/accepted records.

-- Owner-only Phase 2 reversal. Stop LP work and restore previous app first.
-- Refuses to delete financial records, accepted decisions or investor Company links.
-- Unaccepted private scan evidence/settings are derived state and are removed.
begin;
do $$declare name text;found boolean;begin
 if to_regclass('private.phase2_function_baselines') is null then return;end if;
 foreach name in array array['fundraising_funds','lp_pipeline_entries','lp_stage_history','lp_commitments','lp_preferences','lp_tasks','lp_board_investor_links'] loop
  execute format('select exists(select 1 from public.%I)',name) into found;
  if found then raise exception 'Phase 2 has durable LP records; use data-preserving operational rollback/owner backup' using errcode='55000';end if;
 end loop;
 if exists(select 1 from public.capital_events where fundraising_fund_id is not null or lp_flow_kind is not null)
 or exists(select 1 from public.investors where company_id is not null)
 or exists(select 1 from public.lp_suggestions where status='accepted')
 or exists(select 1 from public.lp_contact_requests where status='accepted')
 then raise exception 'Phase 2 has accepted/financial records; preserve data before schema reversal' using errcode='55000';end if;
end$$;
-- Restore the exact prior public entry points and EXECUTE allowlists.
do $$declare b record;a record;r record;role_name text;begin
 if to_regclass('private.phase2_function_baselines') is null then return;end if;
 for b in select * from private.phase2_function_baselines loop
  execute b.definition;
  for r in select distinct x.grantee from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where p.oid=to_regprocedure(b.signature) loop
   role_name:=case when r.grantee=0 then 'public' else quote_ident((select rolname from pg_roles where oid=r.grantee)) end;
   execute format('revoke all on function %s from %s',b.signature,role_name);
  end loop;
  for a in select * from jsonb_to_recordset(b.acl) as x(role oid,grantable boolean) loop
   role_name:=case when a.role=0 then 'public' else quote_ident((select rolname from pg_roles where oid=a.role)) end;
   execute format('grant execute on function %s to %s%s',b.signature,role_name,case when a.grantable then ' with grant option' else '' end);
  end loop;
 end loop;
end$$;
drop trigger if exists guard_lp_flow on public.capital_events;
drop policy if exists lp_audit on public.audit_log;
drop policy if exists lp_board_link_audit_private on public.audit_log;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname||'.'||p.proname=any(array['private.require_lp_worker','public.admin_save_lp_keyword','private.lp_scan_allowed','public.configure_lp_scouting','public.request_lp_scan','private.lp_scan_context','public.my_lp_scan_context','private.claim_lp_scan','public.worker_claim_lp_scan','public.claim_my_lp_scan','private.lp_credential_version','private.valid_lp_lease','public.worker_lp_scan_context','private.commit_lp_scan','public.worker_commit_lp_scan','public.commit_my_lp_scan','private.fail_lp_scan','public.worker_fail_lp_scan','public.fail_my_lp_scan','public.decide_lp_contact','public.decide_lp_suggestion','public.save_lp_record','private.guard_lp_flow','public.lp_management_snapshot']) loop
  execute format('drop function if exists %s cascade',f.signature);
 end loop;
end$$;
-- The old phase-1 function was restored above before removing its phase-2 alias.
drop function if exists private.withdraw_phase1_sync(text);
alter table public.capital_events drop column if exists fundraising_fund_id;
alter table public.capital_events drop column if exists flow_currency;
alter table public.capital_events drop column if exists lp_flow_kind;
alter table public.investors drop column if exists company_id;
drop table if exists public.lp_contact_requests cascade;
drop table if exists public.lp_board_investor_links cascade;
drop table if exists public.lp_tasks cascade;
drop table if exists public.lp_preferences cascade;
drop table if exists public.lp_commitments cascade;
drop table if exists public.lp_stage_history cascade;
drop table if exists public.lp_pipeline_entries cascade;
drop table if exists public.lp_scout_jobs cascade;
drop table if exists public.lp_suggestions cascade;
drop table if exists public.lp_scout_keywords cascade;
drop table if exists public.lp_scouting_settings cascade;
drop table if exists public.fundraising_funds cascade;
drop table if exists private.lp_scout_evidence;
delete from public.member_permissions where permission='lp_scouting';
alter table public.member_permissions drop constraint if exists member_permissions_permission_check;
alter table public.member_permissions add constraint member_permissions_permission_check check(permission in ('portfolio','documents','admin','email_scouting'));
alter table private.machine_identities drop column if exists lp_scanning_enabled;
drop table if exists private.phase2_function_baselines;
commit;
