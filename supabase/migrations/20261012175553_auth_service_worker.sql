-- Auth service worker; requires the complete phase 1 chain. No identity is provisioned here.
begin;
create table if not exists private.machine_identities (
 sub uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default true,
 relationships_only boolean not null default true,
 tokens_valid_after timestamptz not null default '-infinity',
 created_at timestamptz not null default now()
);
alter table private.machine_identities enable row level security;
revoke all on private.machine_identities from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
create or replace function private.is_machine_identity() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.machine_identities where sub=auth.uid())
$$;
revoke all on function private.is_machine_identity() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
grant execute on function private.is_machine_identity() to authenticated;
create or replace function private.require_worker_identity() returns void language plpgsql security definer set search_path='' as $$
declare identity private.machine_identities%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'worker identity required' using errcode='42501';end if;
 select * into identity from private.machine_identities where sub=auth.uid() and enabled for share;
 if identity.sub is null or exists(select 1 from auth.users u join public.app_members m on lower(m.email)=lower(u.email) where u.id=identity.sub)
 then raise exception 'worker identity unavailable' using errcode='42501';end if;
 if identity.tokens_valid_after>'-infinity'::timestamptz and (coalesce(auth.jwt()->>'iat','') !~ '^[0-9]{1,12}$' or to_timestamp((auth.jwt()->>'iat')::double precision)<identity.tokens_valid_after)
 then raise exception 'worker session predates password rotation' using errcode='42501';end if;
 if identity.relationships_only and (exists(select 1 from public.crm_sync_accounts where enabled) or exists(select 1 from public.drive_sources where enabled))
 then raise exception 'relationships-only worker requires CRM and Drive off' using errcode='42501';end if;
end$$;
revoke all on function private.require_worker_identity() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
-- Each registered service identity, even revoked, is excluded from membership and table RLS.
create or replace function private.is_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not private.is_machine_identity() and exists (
    select 1 from public.app_members m
    where m.email = private.current_email() and m.is_active
  )
$$;
create table if not exists private.machine_rls_baselines(relation_id oid primary key,enabled boolean not null,auth_ddl text[] not null);
create table if not exists private.machine_view_baselines(relation_id oid primary key,options text[]);
revoke all on private.machine_rls_baselines,private.machine_view_baselines from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
do $$declare t record;original boolean;begin
 for t in select n.nspname,c.relname,c.oid,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind in ('r','p') loop
  insert into private.machine_rls_baselines values(t.oid,t.relrowsecurity,array(select v from unnest(array['TRUNCATE','REFERENCES','TRIGGER'])v where has_table_privilege('authenticated',t.oid,v))) on conflict do nothing;
  select enabled into original from private.machine_rls_baselines where relation_id=t.oid;
  execute format('revoke truncate,references,trigger on %I.%I from authenticated',t.nspname,t.relname);
  execute format('alter table %I.%I enable row level security',t.nspname,t.relname);
  if not original then
   execute format('drop policy if exists machine_previous_access on %I.%I',t.nspname,t.relname);
   execute format('create policy machine_previous_access on %I.%I for all to public using (true) with check (true)',t.nspname,t.relname);
  end if;
  execute format('drop policy if exists machine_identity_isolation on %I.%I',t.nspname,t.relname);
  execute format('create policy machine_identity_isolation on %I.%I as restrictive for all to authenticated using (not private.is_machine_identity()) with check (not private.is_machine_identity())',t.nspname,t.relname);
 end loop;
 for t in select n.nspname,c.relname,c.oid,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind='v' loop
  insert into private.machine_view_baselines values(t.oid,t.reloptions) on conflict do nothing;
  execute format('alter view %I.%I set (security_invoker=true)',t.nspname,t.relname);
 end loop;
end$$;
-- Owner-installed functions hold the identity row lock for the entire call;
-- revocation waits for in-flight transactions and rejects the next operation.
do $$declare p record;args text;names text;result text;body text;begin
 for p in select x.*,n.nspname from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='public' and x.proname like 'worker\_%' escape '\' loop
  if to_regprocedure('private.auth_'||p.proname||'('||oidvectortypes(p.proargtypes)||')') is null then
   execute format('alter function %s set schema private',p.oid::regprocedure);
   execute format('alter function private.%I(%s) rename to %I',p.proname,pg_get_function_identity_arguments(p.oid),'auth_'||p.proname);
  end if;
 end loop;
 for p in select x.* from pg_proc x join pg_namespace n on n.oid=x.pronamespace where n.nspname='private' and x.proname like 'auth_worker\_%' escape '\' loop
  args:=pg_get_function_arguments(p.oid);result:=pg_get_function_result(p.oid);
  select coalesce(string_agg(quote_ident(a),','),'') into names from unnest(p.proargnames) a;
  body:='begin perform private.require_worker_identity(); ';
  if p.proname='auth_worker_signal_gmail' then body:=body||'raise exception ''Gmail push disabled'' using errcode=''42501'';';
  elsif result='void' then body:=body||format('perform private.%I(%s);',p.proname,names);
  elsif p.proretset then body:=body||format('return query select * from private.%I(%s);',p.proname,names);
  else body:=body||format('return private.%I(%s);',p.proname,names);end if;
  execute format('create or replace function public.%I(%s) returns %s language plpgsql security definer set search_path='''' as %L',substring(p.proname from 6),args,result,body||' end');
  execute format('revoke all on function %s from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',p.oid::regprocedure);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,vanquish_worker,vanquish_gmail_push',substring(p.proname from 6),pg_get_function_identity_arguments(p.oid));
  execute format('grant execute on function public.%I(%s) to authenticated',substring(p.proname from 6),pg_get_function_identity_arguments(p.oid));
 end loop;
end$$;
create or replace function private.can_access_deal(p_deal uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select private.deal_access_for(p_deal,case when private.is_machine_identity() then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,p_write)
$$;
create or replace function private.publish_source_event(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare e public.crm_source_events%rowtype;v_old public.interactions%rowtype;v_company uuid;v_deal uuid;begin
  select * into e from public.crm_source_events where id=p_id;
  if private.is_machine_identity() then perform set_config('vanquish.sync_actor',e.email,true);end if;
  select * into v_old from public.interactions where source_event_id=p_id for update;
  for v_company in select distinct c from unnest(array[e.company_id,v_old.company_id])c where c is not null loop
    insert into private.sync_activity_baselines select 'company',id,last_activity_at from public.companies where id=v_company on conflict do nothing;
  end loop;
  for v_deal in select distinct d from unnest(array[e.deal_id,v_old.deal_id])d where d is not null loop
    insert into private.sync_activity_baselines select 'deal',id,last_activity_at from public.deals where id=v_deal on conflict do nothing;
  end loop;
  if e.status='matched' and e.occurred_at<=now() then
    insert into public.interactions(company_id,deal_id,type,occurred_at,subject,created_by,source_event_id)
    values(e.company_id,e.deal_id,case when e.service='gmail' then 'email' else 'meeting' end,e.occurred_at,
      coalesce(e.subject,case when e.service='gmail' then 'Email activity' else 'Calendar activity' end),e.email,e.id)
    on conflict(source_event_id) where source_event_id is not null do update set company_id=excluded.company_id,deal_id=excluded.deal_id,
      occurred_at=excluded.occurred_at,subject=excluded.subject,archived_at=null;
  else update public.interactions set archived_at=now() where source_event_id=e.id and archived_at is null;end if;
  for v_company in select distinct c from unnest(array[e.company_id,v_old.company_id])c where c is not null loop
    update public.companies set last_activity_at=greatest(
      (select last_activity_at from private.sync_activity_baselines where entity_type='company' and entity_id=v_company),
      (select max(occurred_at) from public.interactions where company_id=v_company and archived_at is null)) where id=v_company;
  end loop;
  for v_deal in select distinct d from unnest(array[e.deal_id,v_old.deal_id])d where d is not null loop
    update public.deals set last_activity_at=greatest(
      (select last_activity_at from private.sync_activity_baselines where entity_type='deal' and entity_id=v_deal),
      (select max(occurred_at) from public.interactions where deal_id=v_deal and archived_at is null)) where id=v_deal;
  end loop;
end$$;
create or replace function private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_log(entity_table,entity_id,operation,actor_email,before_row,after_row)
  values(tg_table_name,coalesce(new.id,old.id),tg_op,
    case when private.is_machine_identity() then nullif(current_setting('vanquish.sync_actor',true),'') else private.current_email() end,
    case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);
  return coalesce(new,old);
end$$;
create or replace function private.guard_document_publisher() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.is_machine_identity() then
    perform private.require_worker_identity();
    if tg_op='INSERT' and (new.uploaded_by is distinct from nullif(current_setting('vanquish.sync_actor',true),'')) then raise exception 'invalid worker publisher' using errcode='42501';end if;
    if tg_op='UPDATE' and new.uploaded_by is distinct from old.uploaded_by then raise exception 'document publisher is immutable' using errcode='42501';end if;
  elsif current_setting('role',true)='authenticated' then
    if tg_op='INSERT' then new.uploaded_by:=private.require_member();
    elsif new.uploaded_by is distinct from old.uploaded_by then raise exception 'document publisher is immutable' using errcode='42501';end if;
  end if;
  return new;
end$$;
commit;
