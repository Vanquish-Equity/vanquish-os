-- Phase 6B; main through 20261028190337 required. Three capabilities default off.

-- Phase 6B only. Prerequisite 6A; existing object_type/permission CHECKs and v0 rows untouched.
begin;
create table if not exists private.customization_configuration(singleton boolean primary key default true check(singleton),views_enabled boolean not null default false,kanban_enabled boolean not null default false,templates_enabled boolean not null default false);
insert into private.customization_configuration values(true,false,false,false) on conflict do nothing;
create table if not exists public.crm_task_templates(
 id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name)) between 1 and 80),version integer not null default 1 check(version>0),archived boolean not null default false,
 task_titles text[] not null default '{}',checklist_titles text[] not null default '{}',check(cardinality(task_titles)<=25 and cardinality(checklist_titles)<=20 and cardinality(task_titles)+cardinality(checklist_titles)>0)
);
create unique index if not exists crm_task_template_name on public.crm_task_templates(lower(btrim(name)));
create table if not exists public.crm_template_applications(
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.crm_task_templates(id),template_version integer not null,
 -- Immutable references validated under caller RLS, without parent FKs that leak hidden applications on deletion.
 company_id uuid not null,deal_id uuid,card_id uuid,
 actor text not null,request_id uuid not null unique,run_number integer not null check(run_number between 1 and 10),task_count integer not null check(task_count between 0 and 25),checklist_count integer not null check(checklist_count between 0 and 20),created_at timestamptz not null default now()
);
create unique index if not exists crm_template_application_run on public.crm_template_applications(template_id,company_id,coalesce(deal_id,'00000000-0000-0000-0000-000000000000'),coalesce(card_id,'00000000-0000-0000-0000-000000000000'),run_number);
create index if not exists crm_template_application_parent on public.crm_template_applications(company_id,deal_id,created_at desc);
-- Generic admin audit receives only this content-free receipt, never application parent/card IDs.
create table if not exists public.crm_template_audit_metadata(id uuid primary key default gen_random_uuid(),template_id uuid not null,actor text not null,task_count integer not null check(task_count between 0 and 25),checklist_count integer not null check(checklist_count between 0 and 20),change_hash text not null check(change_hash ~ '^[a-f0-9]{64}$'),occurred_at timestamptz not null default now());
-- Private, statement-local command envelope, not an application receipt or queue.
-- Only input columns are writable. BEFORE runs as caller and creates real items;
-- AFTER alone has owner privileges to record that completed work, then removes the envelope.
create table if not exists private.vt_application_commands(
 id uuid primary key default gen_random_uuid(),template_id uuid not null,template_version integer not null,
 company_id uuid not null,deal_id uuid,card_id uuid,request_id uuid not null,repeat_requested boolean not null,confirmed boolean not null,
 actor text not null,application_id uuid not null,run_number integer not null,task_count integer not null,checklist_count integer not null,already_applied boolean not null
);
create or replace function private.vt_enabled(p_cap text) returns boolean language plpgsql stable security definer set search_path='' as $$declare flag boolean;begin
 if (select private.is_machine_identity()) or not (select private.is_member()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 select case p_cap when 'views' then views_enabled when 'kanban' then views_enabled and kanban_enabled when 'templates' then templates_enabled else false end into flag from private.customization_configuration where singleton;return coalesce(flag,false);
end$$;
create or replace function private.vt_require(p_cap text,p_admin boolean default false) returns void language plpgsql security definer set search_path='' as $$declare flag boolean;begin
 if (select private.is_machine_identity()) or not (select private.is_member()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 perform 1 from public.app_members where email=private.current_email() and is_active for share;if not found then raise exception 'Customization unavailable' using errcode='42501';end if;
 if p_admin then perform 1 from public.member_permissions where email=private.current_email() and permission='admin' for share;if not found then raise exception 'Admin required' using errcode='42501';end if;perform 1 from private.customization_configuration where singleton for update;
 else perform 1 from private.customization_configuration where singleton for share;end if;
 flag:=private.vt_enabled(p_cap);if not flag then raise exception 'Customization paused' using errcode='42501';end if;
end$$;
create or replace function public.customization_state() returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 return jsonb_build_object('views',private.vt_enabled('views'),'kanban',private.vt_enabled('kanban'),'templates',private.vt_enabled('templates'));
end$$;
create or replace function private.vt_validate_spec(p_object text,p_spec jsonb,p_active boolean default true) returns void language plpgsql stable security invoker set search_path='' as $$
declare key text;keys text[];customs uuid[]:='{}';fid uuid;d public.custom_field_definitions%rowtype;begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 if p_object not in('people','pipeline') or p_object is null or jsonb_typeof(p_spec) is distinct from 'object' or octet_length(p_spec::text)>4096 or p_spec->'version' is distinct from '1'::jsonb or (select count(*) from jsonb_object_keys(p_spec))<>5 or not (p_spec ?& array['version','columns','sort','group','mode']) or exists(select 1 from jsonb_object_keys(p_spec)k where k not in('version','columns','sort','group','mode')) then raise exception 'Invalid v1 specification' using errcode='22023';end if;
 if jsonb_typeof(p_spec->'columns') is distinct from 'array' then raise exception 'Invalid columns' using errcode='22023';end if;
 if jsonb_array_length(p_spec->'columns') not between 1 and 8 or exists(select 1 from jsonb_array_elements(p_spec->'columns')x where jsonb_typeof(x)<>'string') or not(p_spec->'columns' ? 'name') or (select count(distinct x) from jsonb_array_elements_text(p_spec->'columns')x)<>jsonb_array_length(p_spec->'columns') then raise exception 'Invalid columns' using errcode='22023';end if;
 if jsonb_typeof(p_spec->'sort') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_spec->'sort'))<>2 or not(p_spec->'sort' ?& array['key','direction']) or p_spec->'sort'->>'direction' not in('asc','desc') or p_spec->'sort'->>'direction' is null or jsonb_typeof(p_spec->'sort'->'key') is distinct from 'string' or p_spec->>'mode' not in('table','kanban') or p_spec->>'mode' is null or jsonb_typeof(p_spec->'group') not in('null','string') then raise exception 'Invalid layout' using errcode='22023';end if;
 select array_agg(x) into keys from (select jsonb_array_elements_text(p_spec->'columns')x union all select p_spec->'sort'->>'key' union all select p_spec->>'group' where p_spec->>'group' is not null)q;
 foreach key in array keys loop
  if key in('name','company') or p_object='people' and key in('email','linkedin') or p_object='pipeline' and key='stage' then continue;end if;
  if key !~ '^cf:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Column outside allowlist' using errcode='22023';end if;
  fid:=substring(key from 4)::uuid;if key<>'cf:'||fid::text then raise exception 'Custom field UUID must be canonical' using errcode='22023';end if;if not(fid=any(customs)) then customs:=array_append(customs,fid);end if;
 end loop;
 if cardinality(customs)>1 then raise exception 'Only one custom field per view' using errcode='22023';end if;
 if p_spec->>'group' is not null and p_spec->>'group' !~ '^cf:' or p_spec->>'mode'='kanban' and p_spec->>'group' is null then raise exception 'Grouping requires one single-select field' using errcode='22023';end if;
 if p_active and cardinality(customs)=1 then
  if not (select private.cf_enabled()) then raise exception 'Custom fields paused' using errcode='42501';end if;
  select * into d from public.custom_field_definitions where id=customs[1] and object_type=case p_object when 'pipeline' then 'deals' else 'people' end and not archived and filterable and field_type<>'multi_select';
  if not found then raise exception 'Field unavailable' using errcode='22023';end if;
  if p_spec->>'group' is not null and d.field_type<>'single_select' then raise exception 'Grouping requires single-select' using errcode='22023';end if;
 end if;
end$$;
create or replace function private.vt_view_guard() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 if tg_op='DELETE' then if old.filters ? 'version' then perform private.vt_require('views');end if;return old;end if;
 if new.filters ? 'version' then
  perform private.vt_require('views');perform private.vt_validate_spec(new.object_type,new.filters);
  if new.filters->>'mode'='kanban' then perform private.vt_require('kanban');end if;
 elsif tg_op='UPDATE' and old.filters ? 'version' then perform private.vt_require('views');end if;
 return new;
end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.saved_views'::regclass and tgname='vt_view_guard') then create trigger vt_view_guard before insert or update on public.saved_views for each row execute function private.vt_view_guard();end if;if not exists(select 1 from pg_trigger where tgrelid='public.saved_views'::regclass and tgname='vt_view_remove_guard') then create trigger vt_view_remove_guard before delete on public.saved_views for each row execute function private.vt_view_guard();end if;end$$;
create or replace function public.save_customization_view(p_id uuid,p_object text,p_name text,p_shared boolean,p_spec jsonb) returns uuid language plpgsql security invoker set search_path='' as $$declare rid uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;perform private.vt_require('views');perform private.vt_validate_spec(p_object,p_spec);
 if p_id is null then insert into public.saved_views(object_type,name,owner,is_shared,filters) values(p_object,btrim(p_name),private.current_email(),p_shared,p_spec) returning id into rid;
 else update public.saved_views set name=btrim(p_name),is_shared=p_shared,filters=p_spec where id=p_id and object_type=p_object and owner=private.current_email() returning id into rid;end if;
 if rid is null then raise exception 'View unavailable' using errcode='42501';end if;return rid;
end$$;
create or replace function public.customization_view_data(p_view uuid,p_bucket uuid default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v public.saved_views%rowtype;d public.custom_field_definitions%rowtype;spec jsonb;fid uuid;warning boolean:=false;grouped boolean;cap integer;rows_json jsonb;begin
 if (select private.is_machine_identity()) or not private.vt_enabled('views') then raise exception 'Customization unavailable' using errcode='42501';end if;
 select * into v from public.saved_views where id=p_view and filters->'version'='1'::jsonb;if not found then raise exception 'View unavailable' using errcode='42501';end if;
 spec:=v.filters;perform private.vt_validate_spec(v.object_type,spec,false);
 select substring(x from 4)::uuid into fid from (select jsonb_array_elements_text(spec->'columns')x union all select spec->'sort'->>'key' union all select spec->>'group')q where x like 'cf:%' limit 1;
 if fid is not null then
  if private.cf_enabled() then select * into d from public.custom_field_definitions where id=fid and not archived and filterable and object_type=case v.object_type when 'pipeline' then 'deals' else 'people' end and field_type<>'multi_select';end if;
  if d.id is null then
   warning:=true;spec:=jsonb_set(spec,'{columns}',(select jsonb_agg(x order by n) from jsonb_array_elements_text(spec->'columns') with ordinality a(x,n) where x not like 'cf:%'));
   if spec->'sort'->>'key' like 'cf:%' then spec:=jsonb_set(spec,'{sort}','{"key":"name","direction":"asc"}');end if;
   spec:=jsonb_set(jsonb_set(spec,'{group}','null'),'{mode}','"table"');fid:=null;
  end if;
 end if;
 if spec->>'mode'='kanban' and not private.vt_enabled('kanban') then spec:=jsonb_set(spec,'{mode}','"table"');warning:=true;end if;
 grouped:=spec->>'group' is not null;cap:=case when grouped then 25 else 100 end;
 if grouped and d.field_type<>'single_select' then raise exception 'Grouping unavailable' using errcode='22023';end if;
 if warning and fid is null then p_bucket:=null;end if;
 if p_bucket is not null and (not grouped or not exists(select 1 from public.custom_field_options where id=p_bucket and definition_id=fid)) then raise exception 'Invalid bucket' using errcode='22023';end if;
 with base as (
  select p.id,p.name,c.name company,c.id company_id,null::text stage,(select e.email from public.person_emails e where e.person_id=p.id order by e.is_primary desc,e.email limit 1) email,p.linkedin_url linkedin from public.people p left join public.companies c on c.id=p.primary_organization_id and c.deleted_at is null where v.object_type='people' and p.archived_at is null and (p.primary_organization_id is null or c.id is not null)
  union all
  select a.id,a.name,c.name,c.id,s.name,null,null from public.deals a join public.companies c on c.id=a.company_id and c.deleted_at is null left join public.pipeline_stages s on s.id=a.stage_id where v.object_type='pipeline' and a.archived_at is null and (select private.can_access_deal(a.id)) and (select private.can_access_record(a.company_id,a.id))
 ), ordered as (
  select b.*,f.token,case when f.is_set then coalesce(to_jsonb(f.text_value),to_jsonb(f.number_value),to_jsonb(f.date_value),to_jsonb(f.boolean_value),to_jsonb(f.option_value)) end field_value
  from base b left join public.custom_field_values f on f.record_id=b.id and f.definition_id=fid
  where not grouped or f.option_value is not distinct from p_bucket
  order by
   case when spec->'sort'->>'direction'='asc' then case spec->'sort'->>'key' when 'name' then b.name when 'company' then b.company when 'stage' then b.stage when 'email' then b.email when 'linkedin' then b.linkedin else f.text_value end end asc nulls last,
   case when spec->'sort'->>'direction'='desc' then case spec->'sort'->>'key' when 'name' then b.name when 'company' then b.company when 'stage' then b.stage when 'email' then b.email when 'linkedin' then b.linkedin else f.text_value end end desc nulls last,
   case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='asc' then f.number_value end asc nulls last,case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='desc' then f.number_value end desc nulls last,
   case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='asc' then f.date_value end asc nulls last,case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='desc' then f.date_value end desc nulls last,
   case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='asc' then f.boolean_value end asc nulls last,case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='desc' then f.boolean_value end desc nulls last,
   case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='asc' then f.option_value end asc nulls last,case when spec->'sort'->>'key' like 'cf:%' and spec->'sort'->>'direction'='desc' then f.option_value end desc nulls last,b.id limit cap+1
 ) select coalesce(jsonb_agg(to_jsonb(o)),'[]') into rows_json from ordered o;
 return jsonb_build_object('spec',spec,'warning',warning,'definition',case when d.id is null then null else jsonb_build_object('id',d.id,'name',d.name,'field_type',d.field_type,'version',d.version,'options',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label) order by sort_order,id),'[]') from public.custom_field_options where definition_id=d.id)) end,'rows',(select coalesce(jsonb_agg(x order by n),'[]') from jsonb_array_elements(rows_json) with ordinality a(x,n) where n<=cap),'partial',jsonb_array_length(rows_json)>cap);
end$$;
create or replace function public.move_customization_card(p_view uuid,p_record uuid,p_option uuid,p_version integer,p_token uuid,p_confirmed boolean) returns uuid language plpgsql security invoker set search_path='' as $$declare v public.saved_views%rowtype;fid uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;perform private.vt_require('kanban');
 if p_confirmed is distinct from true then raise exception 'Confirmation required' using errcode='22023';end if;
 select * into v from public.saved_views where id=p_view and filters->>'mode'='kanban';if not found then raise exception 'View unavailable' using errcode='42501';end if;perform private.vt_validate_spec(v.object_type,v.filters);
 fid:=substring(v.filters->>'group' from 4)::uuid;
 return public.custom_field_set_value(fid,p_record,p_version,p_token,p_option is not null,p_option=>p_option);
end$$;
-- Read authorization stays STABLE/INVOKER; the older CF write helper is used only on writes.
create or replace function private.vt_parent_read(p_company uuid,p_deal uuid) returns boolean language plpgsql stable security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 if p_deal is null then return exists(select 1 from public.companies c where c.id=p_company and c.deleted_at is null and (select private.can_access_record(c.id,null)));end if;
 return exists(select 1 from public.deals d join public.companies c on c.id=d.company_id and c.deleted_at is null where d.id=p_deal and (p_company is null or d.company_id=p_company) and d.archived_at is null and (select private.can_access_deal(d.id)) and (select private.can_access_record(d.company_id,d.id)));
end$$;
create or replace function private.vt_template_guard() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;perform private.vt_require('templates',true);
 if tg_op='UPDATE' and new.id is distinct from old.id then raise exception 'Immutable template identity' using errcode='22023';end if;
 if tg_op='INSERT' and (select count(*) from public.crm_task_templates)>=50 then raise exception 'Template catalog full' using errcode='22023';end if;
 if coalesce(array_ndims(new.task_titles),1)<>1 or coalesce(array_ndims(new.checklist_titles),1)<>1 or exists(select 1 from unnest(new.task_titles||new.checklist_titles)x where x is null or length(btrim(x)) not between 1 and 200) then raise exception 'Invalid template title' using errcode='22023';end if;
 new.version:=case when tg_op='INSERT' then 1 else old.version+1 end;return new;
end$$;
create or replace function private.vt_application_guard() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;perform private.vt_require('templates');
 if new.actor<>private.current_email() or not private.cf_parent_write(case when new.deal_id is null then 'companies' else 'deals' end,coalesce(new.deal_id,new.company_id)) or new.deal_id is not null and not exists(select 1 from public.deals where id=new.deal_id and company_id=new.company_id) then raise exception 'Target unavailable' using errcode='42501';end if;
 if new.card_id is not null and not exists(select 1 from public.crm_board_items i join public.crm_boards b on b.id=i.board_id where i.id=new.card_id and i.source_company_id=new.company_id and b.archived_at is null) then raise exception 'Card unavailable' using errcode='42501';end if;
 return new;
end$$;
create or replace function private.vt_application_audit() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 if tg_relid<>'public.crm_template_applications'::regclass then raise exception 'Invalid journal origin' using errcode='42501';end if;
 insert into public.crm_template_audit_metadata(template_id,actor,task_count,checklist_count,change_hash) values(new.template_id,new.actor,new.task_count,new.checklist_count,encode(sha256(convert_to(gen_random_uuid()::text||to_jsonb(new)::text,'UTF8')),'hex'));return new;
end$$;
create or replace function public.save_task_template(p_id uuid,p_name text,p_tasks text[],p_checklist text[],p_archived boolean,p_version integer) returns uuid language plpgsql security invoker set search_path='' as $$declare rid uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;perform private.vt_require('templates',true);
 if p_id is null then insert into public.crm_task_templates(name,task_titles,checklist_titles,archived) values(btrim(p_name),p_tasks,p_checklist,p_archived) returning id into rid;
 else update public.crm_task_templates set name=btrim(p_name),task_titles=p_tasks,checklist_titles=p_checklist,archived=p_archived where id=p_id and version=p_version returning id into rid;end if;
 if rid is null then raise exception 'Template changed; reload' using errcode='40001';end if;return rid;
end$$;
create or replace function private.vt_execute_command() returns trigger language plpgsql security invoker set search_path='' as $$
declare t public.crm_task_templates%rowtype;a public.crm_template_applications%rowtype;title text;run integer;created integer;item uuid;begin
 if tg_relid<>'private.vt_application_commands'::regclass or tg_op<>'INSERT' then raise exception 'Invalid command origin' using errcode='42501';end if;
 new.id:=gen_random_uuid();new.actor:=private.current_email();new.already_applied:=false;
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;perform private.vt_require('templates');
 if new.confirmed is distinct from true or new.request_id is null or new.repeat_requested is null then raise exception 'Confirmation required' using errcode='22023';end if;
 if not private.cf_parent_write(case when new.deal_id is null then 'companies' else 'deals' end,coalesce(new.deal_id,new.company_id)) or new.deal_id is not null and not exists(select 1 from public.deals where id=new.deal_id and company_id=new.company_id) then raise exception 'Target unavailable' using errcode='42501';end if;
 select * into t from public.crm_task_templates where id=new.template_id and not archived;if not found then raise exception 'Template unavailable' using errcode='42501';end if;
 if t.version is distinct from new.template_version then raise exception 'Template changed; reload' using errcode='40001';end if;
 if cardinality(t.checklist_titles)>0 and new.card_id is null then raise exception 'Select a Company-linked board card for the checklist' using errcode='22023';end if;
 if new.card_id is not null then
  perform 1 from public.crm_board_items i join public.crm_boards b on b.id=i.board_id where i.id=new.card_id and i.source_company_id=new.company_id and b.archived_at is null for update of i;if not found then raise exception 'Card unavailable' using errcode='42501';end if;
  if (select count(*) from public.crm_board_item_checklist_items where item_id=new.card_id)+cardinality(t.checklist_titles)>200 then raise exception 'Card checklist capacity exceeded' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('template:'||new.template_id::text||':'||new.company_id::text||':'||coalesce(new.deal_id::text,'')||':'||coalesce(new.card_id::text,''),0));
 select * into a from public.crm_template_applications where request_id=new.request_id;
 if found then
  if a.template_id<>new.template_id or a.company_id<>new.company_id or a.deal_id is distinct from new.deal_id or a.card_id is distinct from new.card_id then raise exception 'Request identity changed' using errcode='22023';end if;
  new.application_id:=a.id;new.run_number:=a.run_number;new.task_count:=a.task_count;new.checklist_count:=a.checklist_count;new.already_applied:=true;return new;
 end if;
 select * into a from public.crm_template_applications where template_id=new.template_id and company_id=new.company_id and deal_id is not distinct from new.deal_id and card_id is not distinct from new.card_id order by run_number desc limit 1;
 if found and not new.repeat_requested then new.application_id:=a.id;new.run_number:=a.run_number;new.task_count:=a.task_count;new.checklist_count:=a.checklist_count;new.already_applied:=true;return new;end if;
 run:=coalesce(a.run_number,0)+1;if run>10 then raise exception 'Maximum 10 applications per template/target' using errcode='22023';end if;
 foreach title in array t.task_titles loop insert into public.tasks(company_id,deal_id,title,owner,assignee_email) values(new.company_id,new.deal_id,btrim(title),private.current_email(),private.current_email());get diagnostics created=row_count;if created<>1 then raise exception 'Task creation incomplete' using errcode='22023';end if;end loop;
 foreach title in array t.checklist_titles loop item:=public.add_board_checklist_item(new.card_id,btrim(title));if item is null or not exists(select 1 from public.crm_board_item_checklist_items where id=item and item_id=new.card_id and text=btrim(title)) then raise exception 'Checklist creation incomplete' using errcode='22023';end if;end loop;
 -- Counts come from successful, bounded item creation above, never caller metadata.
 new.application_id:=gen_random_uuid();new.run_number:=run;new.task_count:=cardinality(t.task_titles);new.checklist_count:=cardinality(t.checklist_titles);return new;
end$$;
-- The only receipt-writing capability. Not executable by authenticated (including
-- CREATE TRIGGER on an attacker-owned table). NEW is from the fixed command table,
-- after the invoker BEFORE trigger has authorized and completed the real writes.
create or replace function private.vt_record_command() returns trigger language plpgsql security definer set search_path='' as $$begin
 if (select private.is_machine_identity()) or not (select private.is_member()) or tg_relid<>'private.vt_application_commands'::regclass or tg_op<>'INSERT' or new.actor is distinct from private.current_email() then raise exception 'Invalid receipt origin' using errcode='42501';end if;
 if not new.already_applied then
  insert into public.crm_template_applications(id,template_id,template_version,company_id,deal_id,card_id,actor,request_id,run_number,task_count,checklist_count) values(new.application_id,new.template_id,new.template_version,new.company_id,new.deal_id,new.card_id,new.actor,new.request_id,new.run_number,new.task_count,new.checklist_count);
 end if;
 -- DELETE: statement-local command only, never a receipt, task or protected journal.
 delete from private.vt_application_commands where id=new.id;return new;
end$$;
create or replace function public.apply_task_template(p_template uuid,p_version integer,p_company uuid,p_deal uuid,p_card uuid,p_request uuid,p_repeat boolean,p_confirmed boolean) returns jsonb language plpgsql security invoker set search_path='' as $$declare c private.vt_application_commands%rowtype;begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 insert into private.vt_application_commands(template_id,template_version,company_id,deal_id,card_id,request_id,repeat_requested,confirmed) values(p_template,p_version,p_company,p_deal,p_card,p_request,p_repeat,p_confirmed) returning * into c;
 return jsonb_build_object('id',c.application_id,'alreadyApplied',c.already_applied,'tasks',c.task_count,'checklist',c.checklist_count);
end$$;
-- Owner-only rollback preflight, separately testable for the exact failure reason.
create or replace function private.vt_rollback_guard() returns void language plpgsql stable security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Customization unavailable' using errcode='42501';end if;
 if exists(select 1 from public.saved_views where filters->'version'='1'::jsonb) then raise exception 'Phase 6B protected v1 views' using errcode='P0001';end if;
 if exists(select 1 from public.crm_template_applications) then raise exception 'Phase 6B protected applications' using errcode='P0001';end if;
 if exists(select 1 from public.crm_template_audit_metadata) then raise exception 'Phase 6B protected audit' using errcode='P0001';end if;
 if exists(select 1 from public.crm_task_templates) then raise exception 'Phase 6B protected templates' using errcode='P0001';end if;
end$$;
-- RLS and grants: no new direct checklist grants; invoker application calls the existing ACL-guarded RPC.
do $$declare tab text;sc text;begin
 foreach tab in array array['customization_configuration','vt_application_commands','crm_task_templates','crm_template_applications','crm_template_audit_metadata'] loop
 sc:=case when tab in('customization_configuration','vt_application_commands') then 'private' else 'public' end;
 execute format('alter table %I.%I enable row level security',sc,tab);execute format('revoke all on %I.%I from public,anon,authenticated',sc,tab);
 if not exists(select 1 from pg_policy where polrelid=(sc||'.'||tab)::regclass and polname='machine_identity_isolation') then execute format('create policy machine_identity_isolation on %I.%I as restrictive for all to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',sc,tab);end if;
 end loop;
end$$;
grant select on public.crm_task_templates,public.crm_template_applications,public.crm_template_audit_metadata to authenticated;
grant insert(name,task_titles,checklist_titles,archived) on public.crm_task_templates to authenticated;
grant update(name,task_titles,checklist_titles,archived) on public.crm_task_templates to authenticated;
-- Also revoke legacy column-level grants: REVOKE ALL ON TABLE alone does not remove them.
revoke insert(template_id,template_version,company_id,deal_id,card_id,actor,request_id,run_number,task_count,checklist_count) on public.crm_template_applications from authenticated;
revoke insert(template_id,actor,task_count,checklist_count,change_hash) on public.crm_template_audit_metadata from authenticated;
grant select on private.vt_application_commands to authenticated;
grant insert(template_id,template_version,company_id,deal_id,card_id,request_id,repeat_requested,confirmed) on private.vt_application_commands to authenticated;
-- DROP: remove the old direct-insert path on reapplication of this unapplied phase.
drop policy if exists vt_application_add on public.crm_template_applications;
-- DROP: journals are written only in the protected receipt trigger context.
drop policy if exists vt_journal_add on public.crm_template_audit_metadata;

do $$begin if not exists(select 1 from pg_policy where polrelid='public.crm_task_templates'::regclass and polname='vt_template_read') then
 create policy vt_template_read on public.crm_task_templates for select to authenticated using((select private.vt_enabled('templates')) and (not archived or (select private.has_permission('admin'))));
 create policy vt_template_add on public.crm_task_templates for insert to authenticated with check((select private.has_permission('admin')));
 create policy vt_template_edit on public.crm_task_templates for update to authenticated using((select private.has_permission('admin'))) with check((select private.has_permission('admin')));
 create policy vt_application_read on public.crm_template_applications for select to authenticated using((select private.vt_enabled('templates')) and (select private.vt_parent_read(company_id,deal_id)) and (card_id is null or exists(select 1 from public.crm_board_items where id=card_id)));
 create policy vt_journal_read on public.crm_template_audit_metadata for select to authenticated using((select private.has_permission('admin')) and (select private.is_member()));
 end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.crm_task_templates'::regclass and tgname='vt_template_guard') then
 create trigger vt_template_guard before insert or update on public.crm_task_templates for each row execute function private.vt_template_guard();
 create trigger vt_application_guard before insert on public.crm_template_applications for each row execute function private.vt_application_guard();
 create trigger vt_application_journal after insert on public.crm_template_applications for each row execute function private.vt_application_audit();
 create trigger vt_journal_audit after insert on public.crm_template_audit_metadata for each row execute function private.audit_record();
 create trigger vt_template_audit after insert or update on public.crm_task_templates for each row execute function private.audit_record();
 end if;end$$;
-- DROP: restore existing task audit visibility, including archived/deleted parents.
-- No Phase 6B policy or per-row helper is added to public.audit_log.
drop policy if exists vt_task_audit_parent on public.audit_log;
do $$begin if not exists(select 1 from pg_policy where polrelid='private.vt_application_commands'::regclass and polname='vt_command_add') then
 create policy vt_command_add on private.vt_application_commands for insert to authenticated with check(actor=(select private.current_email()) and (select private.is_member()) and (select private.vt_enabled('templates')));
 create policy vt_command_read on private.vt_application_commands for select to authenticated using(actor=(select private.current_email()) and (select private.is_member()));
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='private.vt_application_commands'::regclass and tgname='vt_execute_command') then
 create trigger vt_execute_command before insert on private.vt_application_commands for each row execute function private.vt_execute_command();
 create trigger vt_record_command after insert on private.vt_application_commands for each row execute function private.vt_record_command();
 end if;end$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and (p.proname like 'vt_%' or p.proname in('customization_state','save_customization_view','customization_view_data','move_customization_card','save_task_template','apply_task_template')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname not in('vt_view_guard','vt_template_guard','vt_application_guard','vt_application_audit','vt_execute_command','vt_record_command','vt_rollback_guard') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end$$;
commit;
