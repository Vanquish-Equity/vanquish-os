-- Phase 4 only. Owner-applied after 20261014184050. Default off; no worker changes.
begin;
create table if not exists private.relationship_intelligence_configuration (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false
);
create table if not exists private.relationship_intelligence_baseline (
 singleton boolean primary key default true check(singleton), permission_check text not null
);
alter table private.relationship_intelligence_configuration enable row level security;
alter table private.relationship_intelligence_baseline enable row level security;
revoke all on private.relationship_intelligence_configuration,private.relationship_intelligence_baseline from public,anon,authenticated;
insert into private.relationship_intelligence_configuration(singleton) values(true) on conflict do nothing;
insert into private.relationship_intelligence_baseline(singleton,permission_check)
 select true,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.member_permissions'::regclass and conname='member_permissions_permission_check'
 on conflict do nothing;
do $$begin
 if not exists(select 1 from private.relationship_intelligence_baseline) then raise exception 'Missing permission baseline';end if;
end$$;
-- DROP: replaces only the permission vocabulary constraint; baseline restored by rollback.
alter table public.member_permissions drop constraint if exists member_permissions_permission_check;
alter table public.member_permissions add constraint member_permissions_permission_check
 check(permission in ('admin','portfolio','documents','email_scouting','lp_scouting','relationship_intelligence'));
do $$declare t text;begin
 foreach t in array array['relationship_intelligence_configuration','relationship_intelligence_baseline'] loop
  if not exists(select 1 from pg_policy where polrelid=('private.'||t)::regclass and polname='machine_identity_isolation') then
   execute format('create policy machine_identity_isolation on private.%I as restrictive for all to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',t);
  end if;
 end loop;
end$$;

-- Minimal definer: locks live authorization/config only, never reads CRM records.
create or replace function private.relationship_intelligence_access(p_required boolean default true)
returns boolean language plpgsql security definer set search_path='' as $$
declare enabled_now boolean;
begin
 if private.is_machine_identity() or not private.is_member() then raise exception 'Relationship access denied' using errcode='42501';end if;
 perform 1 from public.app_members where email=private.current_email() and is_active for share;
 if not found then raise exception 'Relationship access denied' using errcode='42501';end if;
 if p_required then
  perform 1 from public.member_permissions where email=private.current_email() and permission='relationship_intelligence' for share;
  if not found then raise exception 'Relationship access denied' using errcode='42501';end if;
 end if;
 select enabled into enabled_now from private.relationship_intelligence_configuration where singleton for share;
 if p_required and not coalesce(enabled_now,false) then raise exception 'Relationship intelligence paused' using errcode='42501';end if;
 return coalesce(enabled_now,false);
end$$;
revoke all on function private.relationship_intelligence_access(boolean) from public,anon;
grant execute on function private.relationship_intelligence_access(boolean) to authenticated;

-- Consent rows are own-only under RLS. This bounded helper exposes ONLY active,
-- explicitly sharing publishers, not any CRM/history data. Locks fence withdrawal.
create or replace function private.relationship_intelligence_publishers()
returns table(email text,member_key text,label text) language plpgsql security definer set search_path='' as $$
begin
 if private.is_machine_identity() then raise exception 'Relationship access denied' using errcode='42501';end if;
 perform private.relationship_intelligence_access();
 return query select m.email,md5('relationship-member:'||m.email),left(coalesce(nullif(m.display_name,''),'Team member'),160)
 from public.app_members m join public.relationship_sync s on s.member_email=m.email
 where m.is_active and s.enabled order by m.email limit 501 for share of m,s;
end$$;
revoke all on function private.relationship_intelligence_publishers() from public,anon;
grant execute on function private.relationship_intelligence_publishers() to authenticated;

create or replace function public.relationship_intelligence_state()
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if (select private.is_machine_identity()) then raise exception 'Relationship access denied' using errcode='42501';end if;
 return jsonb_build_object('enabled',private.relationship_intelligence_access(false),'allowed',(select private.has_permission('relationship_intelligence')));
end$$;
create or replace function public.relationship_intelligence_members()
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='2s' as $$
declare publishers jsonb;
begin
 if (select private.is_machine_identity()) then raise exception 'Relationship access denied' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.member_key,'name',p.label) order by p.member_key),'[]') into publishers from private.relationship_intelligence_publishers() p;
 return jsonb_build_object('members',coalesce((select jsonb_agg(e.value order by e.value->>'id') from jsonb_array_elements(publishers) with ordinality e(value,n) where e.n<=500),'[]'),'partial',jsonb_array_length(publishers)>500);
end$$;

-- All CRM/history reads are INVOKER/RLS. No Deal, board, provider event or mailbox joins.
-- Fixed budgets: 3 hops; 500 nodes; 2,000 edges; 10,000 daily rows; 20 UI paths.
-- PostgREST hoists function statement_timeout before SELECT; direct SQL callers
-- must SET LOCAL statement_timeout='2s' BEFORE SELECT (see Phase 4 runbook).
create or replace function public.relationship_intelligence_graph(p_person uuid,p_member text)
returns jsonb language plpgsql security invoker set search_path='' set statement_timeout='2s' as $$
declare
 publishers jsonb; root_email text; nodes text[]:=array[]::text[]; edges jsonb:='[]';
 partial boolean:=false; reasons text[]:=array[]::text[]; r record; needed text[];
 today date:=(now() at time zone 'UTC')::date;
 deadline timestamptz:=clock_timestamp()+interval '1500 milliseconds';
begin
 if (select private.is_machine_identity()) then raise exception 'Relationship access denied' using errcode='42501';end if;
 perform private.relationship_intelligence_access();
 if p_person is null or p_member is null or length(p_member)<>32 then raise exception 'Invalid relationship request' using errcode='22023';end if;
 -- Invisible, archived or unavailable parent and unknown UUID have the same response.
 if not exists(select 1 from public.people p where p.id=p_person and p.archived_at is null
  and (p.primary_organization_id is null or exists(select 1 from public.companies c where c.id=p.primary_organization_id and c.deleted_at is null and (select private.can_access_record(c.id,null))))) then
  return jsonb_build_object('status','unavailable','edges','[]'::jsonb);
 end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.member_key),'[]') into publishers from private.relationship_intelligence_publishers() p;
 if jsonb_array_length(publishers)>500 then partial:=true;reasons:=array_append(reasons,'publisher_budget');end if;
 select e->>'email' into root_email from jsonb_array_elements(publishers) with ordinality x(e,n) where n<=500 and e->>'member_key'=p_member;
 if root_email is null then return jsonb_build_object('status','unavailable','edges','[]'::jsonb);end if;
 begin
  for r in
   with publishers_visible as materialized (
    select e->>'email' email,e->>'member_key' member_key,e->>'label' label
    from jsonb_array_elements(publishers) with ordinality x(e,n) where n<=500
   ), visible_companies as materialized (
    -- Correlated parent checks execute once per visible Company, never per history row.
    select c.id from public.companies c where c.deleted_at is null and (select private.can_access_record(c.id,null))
   ), visible_people as materialized (
    select p.id,left(p.name,160) name from public.people p where p.archived_at is null
     and (p.primary_organization_id is null or p.primary_organization_id in(select id from visible_companies))
   ), root_contacts as materialized (
    select distinct h.person_id from public.relationship_interactions h join visible_people v on v.id=h.person_id
    where h.member_email=root_email and h.occurred_on between today-179 and today
    order by h.person_id limit 501
   ), target_members as materialized (
    select distinct h.member_email from public.relationship_interactions h join publishers_visible m on m.email=h.member_email
    where h.person_id=p_person and h.occurred_on between today-179 and today
    order by h.member_email limit 501
   ), daily as materialized (
    select h.person_id,v.name,m.member_key,m.label,h.kind,h.occurred_on,
     case when h.person_id=p_person then 0 when h.member_email=root_email then 1 else 2 end priority
    from public.relationship_interactions h join visible_people v on v.id=h.person_id join publishers_visible m on m.email=h.member_email
    where h.occurred_on between today-179 and today
     and (h.person_id=p_person or (h.person_id in(select person_id from root_contacts) and
       (h.member_email=root_email or h.member_email in(select member_email from target_members))))
    order by priority,h.occurred_on desc,h.person_id,m.member_key,h.kind limit 10001
   ), bounded as materialized (select * from daily order by priority,occurred_on desc,person_id,member_key,kind limit 10000)
   select person_id,name,member_key,label,min(priority) priority,count(distinct occurred_on)::int days,
    count(distinct occurred_on) filter(where kind='meeting')::int meetings,max(occurred_on) last_on,
    (select count(*)>10000 from daily) row_partial,(select count(*)>500 from root_contacts) contact_partial
   from bounded group by person_id,name,member_key,label order by priority,person_id,member_key
  loop
   if r.row_partial or r.contact_partial then partial:=true;reasons:=array_append(reasons,'history_or_contact_budget');end if;
   if clock_timestamp()>deadline then partial:=true;reasons:=array_append(reasons,'time_budget');exit;end if;
   needed:=array[]::text[];
   if not ('p:'||r.person_id::text=any(nodes)) then needed:=array_append(needed,'p:'||r.person_id::text);end if;
   if not ('m:'||r.member_key=any(nodes)) then needed:=array_append(needed,'m:'||r.member_key);end if;
   if cardinality(nodes)+cardinality(needed)>500 then partial:=true;reasons:=array_append(reasons,'node_budget');continue;end if;
   if jsonb_array_length(edges)>=2000 then partial:=true;reasons:=array_append(reasons,'edge_budget');exit;end if;
   nodes:=nodes||needed;
   edges:=edges||jsonb_build_array(jsonb_build_object('person',r.person_id,'personName',r.name,'member',r.member_key,'memberName',r.label,'days',r.days,'meetings',r.meetings,'lastOn',r.last_on));
  end loop;
 exception when query_canceled then partial:=true;reasons:=array_append(reasons,'statement_timeout');
 end;
 return jsonb_build_object('status',case when partial then 'partial' when jsonb_array_length(edges)=0 then 'empty' else 'ready' end,
  'asOf',today,'windowDays',180,'version','v1','reciprocity','unavailable','root',p_member,'target',p_person,
  'nodesVisited',cardinality(nodes),'edges',edges,'reasons',(select coalesce(jsonb_agg(distinct x),'[]') from unnest(reasons)x));
end$$;
revoke all on function public.relationship_intelligence_state(),public.relationship_intelligence_members(),public.relationship_intelligence_graph(uuid,text) from public,anon;
grant execute on function public.relationship_intelligence_state(),public.relationship_intelligence_members(),public.relationship_intelligence_graph(uuid,text) to authenticated;
create index if not exists relationship_intelligence_member_day_person on public.relationship_interactions(member_email,occurred_on desc,person_id);
create index if not exists relationship_intelligence_person_day_member on public.relationship_interactions(person_id,occurred_on desc,member_email);
commit;
