-- Phase 6A; main through 20261016211212 required. Flag remains off.

-- Phase 6A only. No permission/CHECK changes to earlier phases; no Portfolio objects.
begin;
create table if not exists private.custom_fields_configuration(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into private.custom_fields_configuration values(true,false) on conflict do nothing;
create table if not exists public.custom_field_definitions(
 id uuid primary key default gen_random_uuid(),object_type text not null check(object_type in('people','companies','deals')),
 name text not null check(length(btrim(name)) between 1 and 80),field_type text not null check(field_type in('text','number','date','boolean','single_select','multi_select')),
 version integer not null default 1 check(version>0),sort_order integer not null default 0 check(sort_order between 0 and 999),archived boolean not null default false,filterable boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index if not exists cf_definition_name on public.custom_field_definitions(object_type,lower(btrim(name)));
create table if not exists public.custom_field_options(
 id uuid primary key default gen_random_uuid(),definition_id uuid not null references public.custom_field_definitions(id),label text not null check(length(btrim(label)) between 1 and 80),sort_order integer not null default 0 check(sort_order between 0 and 999),version integer not null default 1 check(version>0)
);
create unique index if not exists cf_option_label on public.custom_field_options(definition_id,lower(btrim(label)));
create table if not exists public.custom_field_values(
 id uuid primary key default gen_random_uuid(),definition_id uuid not null references public.custom_field_definitions(id),
 person_id uuid references public.people(id) on delete cascade,company_id uuid references public.companies(id) on delete cascade,deal_id uuid references public.deals(id) on delete cascade,
 record_id uuid generated always as(coalesce(person_id,company_id,deal_id)) stored,
 is_set boolean not null default true,text_value text check(length(text_value)<=2000),number_value numeric check(number_value between -1000000000 and 1000000000 and scale(number_value)<=4),date_value date check(date_value between date '1900-01-01' and date '2200-12-31'),boolean_value boolean,option_value uuid references public.custom_field_options(id),multi_value uuid[] check(cardinality(multi_value)<=20),
 token uuid not null default gen_random_uuid(),updated_at timestamptz not null default now(),
 check(num_nonnulls(person_id,company_id,deal_id)=1),
 check((is_set and num_nonnulls(text_value,number_value,date_value,boolean_value,option_value,multi_value)=1) or(not is_set and num_nonnulls(text_value,number_value,date_value,boolean_value,option_value,multi_value)=0)),
 unique(definition_id,record_id)
);
create index if not exists cf_values_record on public.custom_field_values(record_id,definition_id);
create index if not exists cf_values_text on public.custom_field_values(definition_id,text_value,record_id) where is_set and text_value is not null;
create index if not exists cf_values_number on public.custom_field_values(definition_id,number_value,record_id) where is_set and number_value is not null;
create index if not exists cf_values_date on public.custom_field_values(definition_id,date_value,record_id) where is_set and date_value is not null;
create index if not exists cf_values_boolean on public.custom_field_values(definition_id,boolean_value,record_id) where is_set and boolean_value is not null;
create index if not exists cf_values_option on public.custom_field_values(definition_id,option_value,record_id) where is_set and option_value is not null;
-- Metadata journal only. NEVER attach generic audit_record to custom_field_values.
create table if not exists public.custom_field_audit_metadata(
 id uuid primary key,definition_id uuid not null,object_type text not null check(object_type in('people','companies','deals')),operation text not null check(operation in('INSERT','UPDATE','DELETE')),change_hash text not null check(change_hash ~ '^[a-f0-9]{64}$'),actor_email text,occurred_at timestamptz not null default now()
);
create or replace function private.cf_enabled() returns boolean language plpgsql security definer set search_path='' as $$
declare flag boolean;begin
 if (select private.is_machine_identity()) or not (select private.is_member()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 perform 1 from public.app_members where email=private.current_email() and is_active for share;
 if not found then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 select enabled into flag from private.custom_fields_configuration where singleton for share;return coalesce(flag,false);
end$$;
create or replace function private.cf_require(p_admin boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare flag boolean;begin
 if (select private.is_machine_identity()) or not (select private.is_member()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 perform 1 from public.app_members where email=private.current_email() and is_active for share;if not found then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 if p_admin then
  perform 1 from public.member_permissions where email=private.current_email() and permission='admin' for share;if not found then raise exception 'Admin required' using errcode='42501';end if;
  select enabled into flag from private.custom_fields_configuration where singleton for update;
 else select enabled into flag from private.custom_fields_configuration where singleton for share;end if;
 if not coalesce(flag,false) then raise exception 'Custom fields paused' using errcode='42501';end if;
end$$;
-- INVOKER: locks the visible/editable parent; SELECT FOR UPDATE also applies UPDATE RLS.
create or replace function private.cf_parent_write(p_object text,p_record uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare parent uuid;locked uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 if p_object='people' then
  select p.primary_organization_id into parent from public.people p where p.id=p_record and p.archived_at is null;if not found then return false;end if;
  if parent is not null then perform 1 from public.companies c where c.id=parent and c.deleted_at is null for share;if not found then return false;end if;end if;
  select p.id into locked from public.people p where p.id=p_record and p.archived_at is null and p.primary_organization_id is not distinct from parent for update;
 elsif p_object='companies' then
  select c.id into locked from public.companies c where c.id=p_record and c.deleted_at is null for update;
 elsif p_object='deals' then
  select d.company_id into parent from public.deals d where d.id=p_record and d.archived_at is null;if not found then return false;end if;
  perform 1 from public.companies c where c.id=parent and c.deleted_at is null for share;if not found then return false;end if;
  select d.id into locked from public.deals d where d.id=p_record and d.archived_at is null and d.company_id=parent and (select private.can_access_deal(d.id,true)) and (select private.can_access_record(d.company_id,d.id)) for update;
 else return false;end if;
 return locked is not null;
end$$;
create or replace function private.cf_definition_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare kind text;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 perform private.cf_require(true);
 if tg_table_name='custom_field_definitions' then
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.object_type is distinct from old.object_type or new.field_type is distinct from old.field_type or new.created_at is distinct from old.created_at) then raise exception 'Definition identity/type is immutable';end if;
  if tg_op='INSERT' and (select count(*) from public.custom_field_definitions where object_type=new.object_type)>=30 then raise exception 'Maximum 30 definitions per object';end if;
  if new.filterable and not new.archived and (select count(*) from public.custom_field_definitions where object_type=new.object_type and filterable and not archived and id<>new.id)>=10 then raise exception 'Maximum 10 filterable fields per object';end if;
  new.version:=case when tg_op='INSERT' then 1 else old.version+1 end;
 else
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.definition_id is distinct from old.definition_id) then raise exception 'Option identity is immutable';end if;
  select field_type into kind from public.custom_field_definitions where id=new.definition_id and not archived for update;
  if kind is null or kind not in('single_select','multi_select') then raise exception 'Option definition unavailable';end if;
  if tg_op='INSERT' and (select count(*) from public.custom_field_options where definition_id=new.definition_id)>=50 then raise exception 'Maximum 50 options per field';end if;
  new.version:=case when tg_op='INSERT' then 1 else old.version+1 end;
  update public.custom_field_definitions set name=name where id=new.definition_id;
 end if;return new;
end$$;
create or replace function private.cf_value_guard() returns trigger language plpgsql security invoker set search_path='' as $$
declare d public.custom_field_definitions%rowtype;kind text;rid uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 perform private.cf_require();
 select * into d from public.custom_field_definitions where id=new.definition_id and not archived;
 if not found then raise exception 'Field or record unavailable' using errcode='42501';end if;
 kind:=case when new.person_id is not null then 'people' when new.company_id is not null then 'companies' else 'deals' end;rid:=coalesce(new.person_id,new.company_id,new.deal_id);
 if num_nonnulls(new.person_id,new.company_id,new.deal_id)<>1 or kind<>d.object_type or not private.cf_parent_write(kind,rid) then raise exception 'Field or record unavailable' using errcode='42501';end if;
 if tg_op='UPDATE' and (new.id is distinct from old.id or new.definition_id is distinct from old.definition_id or row(new.person_id,new.company_id,new.deal_id) is distinct from row(old.person_id,old.company_id,old.deal_id)) then raise exception 'Value identity is immutable';end if;
 if new.is_set then
  if num_nonnulls(new.text_value,new.number_value,new.date_value,new.boolean_value,new.option_value,new.multi_value)<>1 or not (case d.field_type when 'text' then new.text_value is not null when 'number' then new.number_value is not null when 'date' then new.date_value is not null when 'boolean' then new.boolean_value is not null when 'single_select' then new.option_value is not null when 'multi_select' then new.multi_value is not null else false end) then raise exception 'Field type mismatch' using errcode='22023';end if;
  if new.option_value is not null and not exists(select 1 from public.custom_field_options where id=new.option_value and definition_id=d.id) then raise exception 'Option unavailable' using errcode='22023';end if;
  if new.multi_value is not null and (cardinality(new.multi_value)>20 or cardinality(new.multi_value)<>(select count(distinct x) from unnest(new.multi_value)x) or cardinality(new.multi_value)<>(select count(*) from public.custom_field_options where definition_id=d.id and id=any(new.multi_value))) then raise exception 'Invalid option selection' using errcode='22023';end if;
 end if;
 new.token:=gen_random_uuid();new.updated_at:=clock_timestamp();return new;
end$$;
create or replace function private.cf_value_audit() returns trigger language plpgsql security invoker set search_path='' as $$
declare r public.custom_field_values%rowtype;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 if tg_relid<>'public.custom_field_values'::regclass then raise exception 'Invalid audit origin';end if;
 r:=case when tg_op='DELETE' then old else new end;
 -- A discarded random salt prevents guessing low-entropy boolean/enum values from audit hashes.
 insert into public.custom_field_audit_metadata(id,definition_id,object_type,operation,change_hash,actor_email) values(gen_random_uuid(),r.definition_id,case when r.person_id is not null then 'people' when r.company_id is not null then 'companies' else 'deals' end,tg_op,encode(pg_catalog.sha256(pg_catalog.convert_to(gen_random_uuid()::text||to_jsonb(r)::text,'UTF8')),'hex'),private.current_email());
 return coalesce(new,old);
end$$;
-- RLS read paths use visible parent relations directly, allowing planner semi/hash joins.
do $$declare t text;sc text;begin
 foreach t in array array['custom_fields_configuration','custom_field_definitions','custom_field_options','custom_field_values','custom_field_audit_metadata'] loop
  sc:=case when t='custom_fields_configuration' then 'private' else 'public' end;
  execute format('alter table %I.%I enable row level security',sc,t);
  execute format('revoke all on %I.%I from public,anon,authenticated',sc,t);
  if not exists(select 1 from pg_policy where polrelid=(sc||'.'||t)::regclass and polname='machine_identity_isolation') then
   execute format('create policy machine_identity_isolation on %I.%I as restrictive for all to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',sc,t);
  end if;
 end loop;
end$$;
grant select on public.custom_field_definitions,public.custom_field_options,public.custom_field_values,public.custom_field_audit_metadata to authenticated;
grant insert(object_type,name,field_type,sort_order,archived,filterable) on public.custom_field_definitions to authenticated;
grant update(name,sort_order,archived,filterable) on public.custom_field_definitions to authenticated;
grant insert(definition_id,label,sort_order) on public.custom_field_options to authenticated;
grant update(label,sort_order) on public.custom_field_options to authenticated;
grant insert(definition_id,person_id,company_id,deal_id,is_set,text_value,number_value,date_value,boolean_value,option_value,multi_value) on public.custom_field_values to authenticated;
grant update(is_set,text_value,number_value,date_value,boolean_value,option_value,multi_value) on public.custom_field_values to authenticated;
grant insert(id,definition_id,object_type,operation,change_hash,actor_email) on public.custom_field_audit_metadata to authenticated;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_definitions'::regclass and polname='cf_def_read') then
 create policy cf_def_read on public.custom_field_definitions for select to authenticated using ((select private.cf_enabled()) and ((select private.has_permission('admin')) or not archived));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_definitions'::regclass and polname='cf_def_insert') then
 create policy cf_def_insert on public.custom_field_definitions for insert to authenticated with check ((select private.is_member()) and (select private.has_permission('admin')));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_definitions'::regclass and polname='cf_def_update') then
 create policy cf_def_update on public.custom_field_definitions for update to authenticated using ((select private.is_member()) and (select private.has_permission('admin'))) with check ((select private.is_member()) and (select private.has_permission('admin')));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_options'::regclass and polname='cf_option_read') then
 create policy cf_option_read on public.custom_field_options for select to authenticated using ((select private.cf_enabled()) and exists(select 1 from public.custom_field_definitions d where d.id=definition_id));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_options'::regclass and polname='cf_option_insert') then
 create policy cf_option_insert on public.custom_field_options for insert to authenticated with check ((select private.is_member()) and (select private.has_permission('admin')));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_options'::regclass and polname='cf_option_update') then
 create policy cf_option_update on public.custom_field_options for update to authenticated using ((select private.is_member()) and (select private.has_permission('admin'))) with check ((select private.is_member()) and (select private.has_permission('admin')));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_audit_metadata'::regclass and polname='cf_audit_read') then
 create policy cf_audit_read on public.custom_field_audit_metadata for select to authenticated using ((select not private.is_machine_identity()) and (select private.has_permission('admin')));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_audit_metadata'::regclass and polname='cf_audit_insert') then
 create policy cf_audit_insert on public.custom_field_audit_metadata for insert to authenticated with check (pg_trigger_depth()>0 and (select private.is_member()) and actor_email=(select private.current_email()));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_values'::regclass and polname='cf_value_read') then
 create policy cf_value_read on public.custom_field_values for select to authenticated using ((select private.cf_enabled()) and exists(select 1 from public.custom_field_definitions f where f.id=definition_id and not f.archived) and (
(person_id is not null and exists(select 1 from public.people p where p.id=person_id and p.archived_at is null and (p.primary_organization_id is null or exists(select 1 from public.companies c where c.id=p.primary_organization_id and c.deleted_at is null)))) or
(company_id is not null and exists(select 1 from public.companies c where c.id=company_id and c.deleted_at is null and (select private.can_access_record(c.id,null)))) or
(deal_id is not null and exists(select 1 from public.deals d join public.companies c on c.id=d.company_id and c.deleted_at is null where d.id=deal_id and d.archived_at is null and (select private.can_access_deal(d.id)) and (select private.can_access_record(d.company_id,d.id))))));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_values'::regclass and polname='cf_value_insert') then
 create policy cf_value_insert on public.custom_field_values for insert to authenticated with check ((select private.cf_enabled()) and exists(select 1 from public.custom_field_definitions f where f.id=definition_id and not f.archived) and (select private.cf_parent_write(case when person_id is not null then 'people' when company_id is not null then 'companies' else 'deals' end,coalesce(person_id,company_id,deal_id))));end if;end$$;
do $$begin if not exists(select 1 from pg_policy where polrelid='public.custom_field_values'::regclass and polname='cf_value_update') then
 create policy cf_value_update on public.custom_field_values for update to authenticated using ((select private.cf_enabled()) and exists(select 1 from public.custom_field_definitions f where f.id=definition_id and not f.archived) and (select private.cf_parent_write(case when person_id is not null then 'people' when company_id is not null then 'companies' else 'deals' end,coalesce(person_id,company_id,deal_id)))) with check ((select private.cf_enabled()) and exists(select 1 from public.custom_field_definitions f where f.id=definition_id and not f.archived) and (select private.cf_parent_write(case when person_id is not null then 'people' when company_id is not null then 'companies' else 'deals' end,coalesce(person_id,company_id,deal_id))));end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.custom_field_definitions'::regclass and tgname='cf_definition_guard') then create trigger cf_definition_guard before insert or update on public.custom_field_definitions for each row execute function private.cf_definition_guard();end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.custom_field_options'::regclass and tgname='cf_option_guard') then create trigger cf_option_guard before insert or update on public.custom_field_options for each row execute function private.cf_definition_guard();end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.custom_field_values'::regclass and tgname='cf_value_guard') then create trigger cf_value_guard before insert or update on public.custom_field_values for each row execute function private.cf_value_guard();end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.custom_field_values'::regclass and tgname='cf_value_audit') then create trigger cf_value_audit after insert or update or delete on public.custom_field_values for each row execute function private.cf_value_audit();end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.custom_field_audit_metadata'::regclass and tgname='cf_metadata_audit') then create trigger cf_metadata_audit after insert on public.custom_field_audit_metadata for each row execute function private.audit_record();end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.custom_field_definitions'::regclass and tgname='cf_definition_audit') then create trigger cf_definition_audit after insert or update on public.custom_field_definitions for each row execute function private.audit_record();end if;end$$;
do $$begin if not exists(select 1 from pg_trigger where tgrelid='public.custom_field_options'::regclass and tgname='cf_option_audit') then create trigger cf_option_audit after insert or update on public.custom_field_options for each row execute function private.audit_record();end if;end$$;
create or replace function public.custom_fields_state() returns boolean language plpgsql security invoker set search_path='' as $$begin if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;return private.cf_enabled();end$$;
create or replace function public.custom_field_save_definition(p_id uuid,p_object text,p_name text,p_type text,p_order integer,p_archived boolean,p_filterable boolean,p_version integer) returns uuid language plpgsql security invoker set search_path='' as $$
declare r uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;perform private.cf_require(true);
 if p_id is null then insert into public.custom_field_definitions(object_type,name,field_type,sort_order,archived,filterable) values(p_object,btrim(p_name),p_type,p_order,p_archived,p_filterable) returning id into r;
 else update public.custom_field_definitions set name=btrim(p_name),sort_order=p_order,archived=p_archived,filterable=p_filterable where id=p_id and object_type=p_object and field_type=p_type and version=p_version returning id into r;if r is null then raise exception 'Definition changed or unavailable' using errcode='40001';end if;end if;return r;
end$$;
create or replace function public.custom_field_save_option(p_id uuid,p_definition uuid,p_label text,p_order integer,p_version integer) returns uuid language plpgsql security invoker set search_path='' as $$
declare r uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;perform private.cf_require(true);
 if p_id is null then insert into public.custom_field_options(definition_id,label,sort_order) values(p_definition,btrim(p_label),p_order) returning id into r;
 else update public.custom_field_options set label=btrim(p_label),sort_order=p_order where id=p_id and definition_id=p_definition and version=p_version returning id into r;if r is null then raise exception 'Option changed or unavailable' using errcode='40001';end if;end if;return r;
end$$;
create or replace function public.custom_field_set_value(p_definition uuid,p_record uuid,p_version integer,p_token uuid,p_set boolean,p_text text default null,p_number numeric default null,p_date date default null,p_boolean boolean default null,p_option uuid default null,p_multi uuid[] default null) returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.custom_field_definitions%rowtype;v public.custom_field_values%rowtype;r uuid;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;perform private.cf_require();
 select * into d from public.custom_field_definitions where id=p_definition and not archived;
 if d.id is null or d.version<>p_version or not private.cf_parent_write(d.object_type,p_record) then raise exception 'Field or record changed/unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('cf-value:'||p_definition::text||':'||p_record::text,0));
 select * into v from public.custom_field_values where definition_id=p_definition and record_id=p_record for update;
 if v.id is not null then
  if p_token is distinct from v.token then raise exception 'Value changed; reload before saving' using errcode='40001';end if;
  update public.custom_field_values set is_set=p_set,text_value=p_text,number_value=p_number,date_value=p_date,boolean_value=p_boolean,option_value=p_option,multi_value=p_multi where id=v.id returning token into r;
 else
  if p_token is not null then raise exception 'Value changed; reload before saving' using errcode='40001';end if;
  insert into public.custom_field_values(definition_id,person_id,company_id,deal_id,is_set,text_value,number_value,date_value,boolean_value,option_value,multi_value) values(p_definition,case when d.object_type='people' then p_record end,case when d.object_type='companies' then p_record end,case when d.object_type='deals' then p_record end,p_set,p_text,p_number,p_date,p_boolean,p_option,p_multi) returning token into r;
 end if;return r;
end$$;
-- One field/filter per bounded request; static SQL only, not a jsonb query language.
create or replace function public.custom_field_search(p_definition uuid,p_operator text,p_text text default null,p_number numeric default null,p_date date default null,p_boolean boolean default null,p_option uuid default null,p_sort text default 'record',p_limit integer default 100)
returns table(record_id uuid) language plpgsql security invoker set search_path='' as $$
declare d public.custom_field_definitions%rowtype;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;perform private.cf_require();
 select * into d from public.custom_field_definitions where id=p_definition and not archived and filterable;
 if d.id is null then raise exception 'Filter unavailable' using errcode='42501';end if;
 if p_limit is null or p_limit<1 or p_limit>100 or p_sort is null or p_sort not in('record','value_asc','value_desc') or p_operator is null then raise exception 'Invalid filter budget';end if;
 if not coalesce(case d.field_type when 'text' then p_operator in('eq','contains') and p_text is not null and length(p_text)<=2000 when 'number' then p_operator in('eq','lt','gt') and p_number between -1000000000 and 1000000000 and scale(p_number)<=4 when 'date' then p_operator in('eq','lt','gt') and p_date between date '1900-01-01' and date '2200-12-31' when 'boolean' then p_operator='eq' and p_boolean is not null when 'single_select' then p_operator='eq' and p_option is not null when 'multi_select' then p_operator='contains' and p_option is not null and p_sort='record' else false end,false) then raise exception 'Invalid typed filter';end if;
 if d.field_type in('single_select','multi_select') and not exists(select 1 from public.custom_field_options where id=p_option and definition_id=d.id) then raise exception 'Option unavailable';end if;
 return query select v.record_id from public.custom_field_values v where v.definition_id=d.id and v.is_set and case d.field_type
 when 'text' then case p_operator when 'eq' then v.text_value=p_text else strpos(v.text_value,p_text)>0 end
 when 'number' then case p_operator when 'eq' then v.number_value=p_number when 'lt' then v.number_value<p_number else v.number_value>p_number end
 when 'date' then case p_operator when 'eq' then v.date_value=p_date when 'lt' then v.date_value<p_date else v.date_value>p_date end
 when 'boolean' then v.boolean_value=p_boolean when 'single_select' then v.option_value=p_option when 'multi_select' then p_option=any(v.multi_value) else false end
 order by case when p_sort='value_asc' then v.text_value end asc,case when p_sort='value_desc' then v.text_value end desc,case when p_sort='value_asc' then v.number_value end asc,case when p_sort='value_desc' then v.number_value end desc,case when p_sort='value_asc' then v.date_value end asc,case when p_sort='value_desc' then v.date_value end desc,case when p_sort='value_asc' then v.boolean_value end asc,case when p_sort='value_desc' then v.boolean_value end desc,case when p_sort='value_asc' then v.option_value end asc,case when p_sort='value_desc' then v.option_value end desc,v.record_id limit p_limit+1;
end$$;
create or replace function private.cf_parent_read(p_object text,p_record uuid) returns boolean language plpgsql security invoker set search_path='' as $$begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;
 return case p_object
 when 'people' then exists(select 1 from public.people p where p.id=p_record and p.archived_at is null and (p.primary_organization_id is null or exists(select 1 from public.companies c where c.id=p.primary_organization_id and c.deleted_at is null)))
 when 'companies' then exists(select 1 from public.companies c where c.id=p_record and c.deleted_at is null and (select private.can_access_record(c.id,null)))
 when 'deals' then exists(select 1 from public.deals d join public.companies c on c.id=d.company_id and c.deleted_at is null where d.id=p_record and d.archived_at is null and (select private.can_access_deal(d.id)) and (select private.can_access_record(d.company_id,d.id))) else false end;
end$$;
create or replace function public.custom_field_record(p_object text,p_record uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare defs jsonb;vals jsonb;editable boolean;begin
 if (select private.is_machine_identity()) then raise exception 'Custom fields unavailable' using errcode='42501';end if;perform private.cf_require();
 if not private.cf_parent_read(p_object,p_record) then raise exception 'Record unavailable' using errcode='42501';end if;
 begin editable:=private.cf_parent_write(p_object,p_record);exception when insufficient_privilege then editable:=false;end;
 select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('options',(select coalesce(jsonb_agg(to_jsonb(o) order by o.sort_order,o.id),'[]'::jsonb) from public.custom_field_options o where o.definition_id=d.id)) order by d.sort_order,d.id),'[]'::jsonb) into defs from public.custom_field_definitions d where d.object_type=p_object and not d.archived;
 select coalesce(jsonb_agg(to_jsonb(v) order by v.definition_id),'[]'::jsonb) into vals from public.custom_field_values v where v.record_id=p_record and v.definition_id in(select id from public.custom_field_definitions where object_type=p_object and not archived);
 return jsonb_build_object('definitions',defs,'values',vals,'canEdit',editable);
end$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.proname in('cf_enabled','cf_require','cf_parent_write','cf_parent_read','cf_definition_guard','cf_value_guard','cf_value_audit','custom_fields_state','custom_field_save_definition','custom_field_save_option','custom_field_set_value','custom_field_search','custom_field_record') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname not in('cf_definition_guard','cf_value_guard','cf_value_audit') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end$$;
commit;
