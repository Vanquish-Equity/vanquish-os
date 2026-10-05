-- Email scouting: for members with the email_scouting permission, their own
-- Gmail is scanned for companies that aren't in the CRM yet. Suggestions
-- and contact requests are private to that member. Stored per suggestion:
-- the domain, a suggested name, thread counts, dates and the contacts'
-- names/emails at that domain — never subjects or message content.

create table public.scouting_settings (
  member_email text primary key references public.app_members(email) on update cascade on delete cascade,
  -- What happens to a suggestion's contacts when its company is created:
  -- request = queue them for approval, skip = don't add, auto = add to People.
  contact_mode text not null default 'request' check (contact_mode in ('request', 'skip', 'auto')),
  last_scanned_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.scouting_settings enable row level security;
revoke all on public.scouting_settings from public,anon,authenticated;
grant select,insert,update on public.scouting_settings to authenticated;
create policy scouting_settings_own_read on public.scouting_settings
  for select to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()));
create policy scouting_settings_own_add on public.scouting_settings
  for insert to authenticated
  with check ((select private.is_member()) and member_email=(select private.current_email()));
create policy scouting_settings_own_edit on public.scouting_settings
  for update to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()))
  with check ((select private.is_member()) and member_email=(select private.current_email()));

create table public.company_suggestions (
  id uuid primary key default gen_random_uuid(),
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  domain text not null check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' and char_length(domain) <= 253),
  suggested_name text not null check (char_length(btrim(suggested_name)) between 1 and 200),
  thread_count integer not null default 0 check (thread_count >= 0),
  two_way boolean not null default false,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(contacts) = 'array'),
  status text not null default 'open' check (status in ('open', 'accepted', 'dismissed')),
  company_id uuid references public.companies(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_email, domain)
);
alter table public.company_suggestions enable row level security;
revoke all on public.company_suggestions from public,anon,authenticated;
grant select,insert,update on public.company_suggestions to authenticated;
create policy company_suggestions_own_read on public.company_suggestions
  for select to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()));
create policy company_suggestions_own_add on public.company_suggestions
  for insert to authenticated
  with check (
    (select private.is_member()) and member_email=(select private.current_email())
    and (select private.has_permission('email_scouting')) and status='open'
  );
-- Only open suggestions are refreshed or dismissed here; accepting goes
-- through accept_company_suggestion so the company is created with it.
create policy company_suggestions_own_edit on public.company_suggestions
  for update to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()) and status='open')
  with check (member_email=(select private.current_email()) and status in ('open','dismissed') and company_id is null);

create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  member_email text not null references public.app_members(email) on update cascade on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  person_id uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (member_email, email)
);
create index contact_requests_member_pending_idx on public.contact_requests(member_email) where status='pending';
alter table public.contact_requests enable row level security;
revoke all on public.contact_requests from public,anon,authenticated;
grant select,update on public.contact_requests to authenticated;
create policy contact_requests_own_read on public.contact_requests
  for select to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()));
-- Declining is a plain update; accepting goes through accept_contact_request.
create policy contact_requests_own_decline on public.contact_requests
  for update to authenticated
  using ((select private.is_member()) and member_email=(select private.current_email()) and status='pending')
  with check (member_email=(select private.current_email()) and status='declined' and person_id is null);

-- Ignored domains are admin-managed; scouting members may read the list so
-- their scan can skip those domains.
create function public.scouting_ignored_domains()
returns setof text language sql stable security definer set search_path='' as $$
  select domain from public.ignored_email_domains
  where private.is_member() and private.has_permission('email_scouting')
$$;
revoke all on function public.scouting_ignored_domains() from public,anon;
grant execute on function public.scouting_ignored_domains() to authenticated;

-- Adds one Person (with its email) to a company unless that email is
-- already in People; returns the Person either way.
create function private.scouting_person(p_email text, p_name text, p_company uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_person uuid;
begin
  select person_id into v_person from public.person_emails where lower(email)=lower(p_email) limit 1;
  if v_person is not null then
    return v_person;
  end if;
  insert into public.people (name, primary_organization_id) values (p_name, p_company) returning id into v_person;
  insert into public.person_emails (person_id, email, is_primary) values (v_person, lower(p_email), true);
  insert into public.activity_events (event_type, target_type, target_id, payload, actor)
  values ('PERSON_CREATED', 'person', v_person,
          jsonb_build_object('name', p_name, 'companyId', p_company, 'source', 'email_scouting'),
          coalesce(private.current_email(), 'system'));
  return v_person;
end $$;
revoke all on function private.scouting_person(text, text, uuid) from public,anon,authenticated;

-- Creates the company for one of the caller's open suggestions and handles
-- its contacts according to the caller's contact_mode, in one transaction.
create function public.accept_company_suggestion(p_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_suggestion public.company_suggestions%rowtype;
  v_company uuid;
  v_mode text;
  v_contact jsonb;
  v_email text;
  v_name text;
begin
  perform private.require_member();
  select * into v_suggestion from public.company_suggestions
  where id=p_id and member_email=private.current_email() and status='open' for update;
  if v_suggestion.id is null then
    raise exception 'This suggestion is no longer open.' using errcode='22023';
  end if;
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'Enter a company name under 200 characters.' using errcode='22023';
  end if;

  insert into public.companies (name, website) values (v_name, 'https://' || v_suggestion.domain)
  returning id into v_company;
  insert into public.activity_events (event_type, target_type, target_id, payload, actor)
  values ('COMPANY_CREATED', 'company', v_company,
          jsonb_build_object('companyId', v_company, 'source', 'email_scouting'),
          private.current_email());

  select coalesce((select contact_mode from public.scouting_settings where member_email=private.current_email()), 'request')
  into v_mode;
  for v_contact in select * from jsonb_array_elements(v_suggestion.contacts) loop
    v_email := lower(btrim(coalesce(v_contact->>'email', '')));
    v_name := nullif(btrim(coalesce(v_contact->>'name', '')), '');
    if v_email = '' or char_length(v_email) > 254 then continue; end if;
    v_name := left(coalesce(v_name, split_part(v_email, '@', 1)), 200);
    if exists (select 1 from public.person_emails where lower(email)=v_email) then continue; end if;
    if v_mode = 'auto' then
      perform private.scouting_person(v_email, v_name, v_company);
    elsif v_mode = 'request' then
      insert into public.contact_requests (member_email, company_id, email, name)
      values (private.current_email(), v_company, v_email, v_name)
      on conflict (member_email, email) do nothing;
    end if;
  end loop;

  update public.company_suggestions
  set status='accepted', company_id=v_company, updated_at=now()
  where id=p_id;
  return v_company;
end $$;
revoke all on function public.accept_company_suggestion(uuid, text) from public,anon;
grant execute on function public.accept_company_suggestion(uuid, text) to authenticated;

create function public.accept_contact_request(p_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_request public.contact_requests%rowtype;
  v_person uuid;
begin
  perform private.require_member();
  select * into v_request from public.contact_requests
  where id=p_id and member_email=private.current_email() and status='pending' for update;
  if v_request.id is null then
    raise exception 'This contact request is no longer pending.' using errcode='22023';
  end if;
  v_person := private.scouting_person(v_request.email, v_request.name, v_request.company_id);
  update public.contact_requests
  set status='accepted', person_id=v_person, decided_at=now()
  where id=p_id;
  return v_person;
end $$;
revoke all on function public.accept_contact_request(uuid) from public,anon;
grant execute on function public.accept_contact_request(uuid) to authenticated;
