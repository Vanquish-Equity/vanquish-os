-- Phase 5A only. No body store, sender worker, watch or external activation.
begin;
create table if not exists private.mail_completion_configuration(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
create table if not exists private.mail_completion_baseline(singleton boolean primary key default true check(singleton),permission_check text not null);
insert into private.mail_completion_configuration(singleton) values(true) on conflict do nothing;
insert into private.mail_completion_baseline select true,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.member_permissions'::regclass and conname='member_permissions_permission_check' on conflict do nothing;
do $$begin if not exists(select 1 from private.mail_completion_baseline) then raise exception 'Missing permission baseline';end if;end$$;
-- DROP: extend only the canonical permission vocabulary; exact baseline retained.
alter table public.member_permissions drop constraint member_permissions_permission_check;
alter table public.member_permissions add constraint member_permissions_permission_check check(permission in ('admin','portfolio','documents','email_scouting','lp_scouting','relationship_intelligence','mail_completion'));
create table if not exists private.mail_mutation_reviews(
 id uuid primary key,owner_email text not null references public.app_members(email),
 operation text not null check(operation in ('save','send','discard')),
 revision text not null check(revision ~ '^[a-f0-9]{64}$'),connection_revision text not null check(length(connection_revision)<=100),
 draft_id text check(draft_id ~ '^[a-zA-Z0-9_-]{1,250}$'),
 state text not null default 'pending' check(state in ('pending','claimed','cancelled','completed','uncertain')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '10 minutes',dispatch_started_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '10 minutes')
);
create unique index if not exists mail_review_send_once on private.mail_mutation_reviews(owner_email,draft_id) where operation='send' and state<>'cancelled';
create index if not exists mail_review_owner_time on private.mail_mutation_reviews(owner_email,created_at desc);
create index if not exists mail_review_owner_expiry on private.mail_mutation_reviews(owner_email,expires_at desc,id) where state in ('pending','claimed');
-- DESIGN METADATA ONLY: no enqueue RPC, payload, secret, body, recipient list or dispatcher.
create table if not exists private.mail_scheduled_design(
 id uuid primary key,owner_email text not null references public.app_members(email),
 draft_id text not null check(draft_id ~ '^[a-zA-Z0-9_-]{1,250}$'),
 confirmed_revision text not null check(confirmed_revision ~ '^[a-f0-9]{64}$'),
 confirmed_at timestamptz not null,due_at timestamptz not null,
 state text not null check(state in ('pending','claimed','cancelled','sent','uncertain')),
 check(due_at>confirmed_at and due_at<=confirmed_at+interval '30 days')
);
do $$declare t text;begin
 foreach t in array array['mail_completion_configuration','mail_completion_baseline','mail_mutation_reviews','mail_scheduled_design'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  if not exists(select 1 from pg_policy where polrelid=('private.'||t)::regclass and polname='machine_identity_isolation') then
   execute format('create policy machine_identity_isolation on private.%I as restrictive for all to authenticated using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()))',t);
  end if;
 end loop;
end$$;
-- Only metadata helpers are definers. No credentials or message content are returned.
create or replace function private.mail_completion_access(p_write boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $$
declare conn public.google_mailbox_connections%rowtype;flag boolean;
begin
 if private.is_machine_identity() or not private.is_member() then raise exception 'Mail access denied' using errcode='42501';end if;
 perform 1 from public.app_members where email=private.current_email() and is_active for share;
 if not found then raise exception 'Mail access denied' using errcode='42501';end if;
 perform 1 from public.member_permissions where email=private.current_email() and permission='mail_completion' for share;
 if not found then raise exception 'Mail completion permission required' using errcode='42501';end if;
 select enabled into flag from private.mail_completion_configuration where singleton for share;
 if not coalesce(flag,false) then raise exception 'Mail completion paused' using errcode='42501';end if;
 select * into conn from public.google_mailbox_connections where email=private.current_email() for share;
 if not found then raise exception 'Reconnect Google' using errcode='42501';end if;
 if p_write and not (conn.granted_scopes && array['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/gmail.compose','https://www.googleapis.com/auth/gmail.send']) then raise exception 'Reconnect Google for draft writing' using errcode='42501';end if;
 return jsonb_build_object('owner',private.current_email(),'connectionRevision',md5(row(conn.updated_at,conn.refresh_token_encrypted,conn.refresh_token_iv,conn.refresh_token_tag,conn.granted_scopes)::text),'scopes',to_jsonb(conn.granted_scopes));
end$$;
create or replace function private.mail_completion_state()
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if private.is_machine_identity() or not private.is_member() then raise exception 'Mail access denied' using errcode='42501';end if;
 perform 1 from private.mail_completion_configuration where singleton and enabled for share;
 return found and private.has_permission('mail_completion');
end$$;
create or replace function private.create_mail_review(p_id uuid,p_operation text,p_revision text,p_connection text,p_draft text)
returns uuid language plpgsql security definer set search_path='' as $$
declare ctx jsonb;old private.mail_mutation_reviews%rowtype;
begin
 if private.is_machine_identity() then raise exception 'Mail access denied' using errcode='42501';end if;
 ctx:=private.mail_completion_access();
 if p_id is null or p_operation is null or p_operation not in ('save','send','discard') or p_revision is null or p_revision !~ '^[a-f0-9]{64}$' or p_connection is distinct from ctx->>'connectionRevision' then raise exception 'Invalid mail review' using errcode='42501';end if;
 if p_operation in ('send','discard') and p_draft is null then raise exception 'Draft required';end if;
 if p_operation in ('save','discard') and not ((ctx->'scopes') ?| array['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/gmail.compose']) then raise exception 'Reconnect Google for draft writing' using errcode='42501';end if;
 -- Serialize per owner, bound metadata creation; never clean up protected outcomes automatically.
 perform pg_advisory_xact_lock(hashtextextended('mail-review:'||private.current_email(),0));
 select * into old from private.mail_mutation_reviews where id=p_id;
 if found then
  if old.owner_email<>private.current_email() or old.operation<>p_operation or old.revision<>p_revision or old.connection_revision<>p_connection or old.draft_id is distinct from p_draft then raise exception 'Mail review collision' using errcode='42501';end if;
  return old.id;
 end if;
 if (select count(*) from private.mail_mutation_reviews where owner_email=private.current_email() and created_at>now()-interval '1 hour')>=60 then raise exception 'Mail review budget exhausted';end if;
 insert into private.mail_mutation_reviews(id,owner_email,operation,revision,connection_revision,draft_id) values(p_id,private.current_email(),p_operation,p_revision,p_connection,p_draft);
 return p_id;
end$$;
create or replace function private.advance_mail_review(p_id uuid,p_event text,p_revision text default null)
returns text language plpgsql security definer set search_path='' as $$
declare r private.mail_mutation_reviews%rowtype;ctx jsonb;
begin
 if private.is_machine_identity() or not private.is_member() then raise exception 'Mail access denied' using errcode='42501';end if;
 -- Authorization rows first; same lock order for every dispatch transition.
 if p_event in ('claim','dispatch') then ctx:=private.mail_completion_access();end if;
 select * into r from private.mail_mutation_reviews where id=p_id and owner_email=private.current_email() for update;
 if not found then raise exception 'Mail review unavailable' using errcode='42501';end if;
 if p_event in ('claim','dispatch') and r.operation in ('save','discard') and not ((ctx->'scopes') ?| array['https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/gmail.compose']) then raise exception 'Reconnect Google for draft writing' using errcode='42501';end if;
 if p_event='cancel' then
  if r.state in ('completed','uncertain','cancelled') then return r.state;end if;
  update private.mail_mutation_reviews set state=case when dispatch_started_at is null then 'cancelled' else 'uncertain' end where id=p_id returning state into r.state;
  return r.state;
 elsif p_event in ('claim','dispatch') then
  if r.revision is distinct from p_revision or r.connection_revision is distinct from ctx->>'connectionRevision' or r.expires_at<=now() then raise exception 'Mail review expired or changed' using errcode='42501';end if;
  if p_event='claim' and r.state='pending' then update private.mail_mutation_reviews set state='claimed' where id=p_id;return 'claimed';end if;
  if p_event='dispatch' and r.state='claimed' and r.dispatch_started_at is null then update private.mail_mutation_reviews set dispatch_started_at=clock_timestamp() where id=p_id;return 'claimed';end if;
 elsif p_event in ('completed','uncertain') then
  if r.state=p_event then return r.state;end if;
  if r.state='claimed' and r.dispatch_started_at is not null then update private.mail_mutation_reviews set state=p_event where id=p_id;return p_event;end if;
 end if;
 raise exception 'Illegal mail transition; never retry uncertain mutations' using errcode='42501';
end$$;
create or replace function private.mail_schedule_next(p_state text,p_event text,p_started boolean default false)
returns text language plpgsql security invoker set search_path='' as $$
begin
 if (select private.is_machine_identity()) then raise exception 'Mail access denied' using errcode='42501';end if;
 perform private.mail_completion_access();
 if p_state='pending' and p_event='claim' then return 'claimed';end if;
 if p_state='pending' and p_event='cancel' then return 'cancelled';end if;
 if p_state='claimed' and p_event='cancel' then return case when p_started then 'uncertain' else 'cancelled' end;end if;
 if p_state='claimed' and p_started and p_event='confirmed' then return 'sent';end if;
 if p_state='claimed' and p_event='lost_result' then return 'uncertain';end if;
 raise exception 'Illegal scheduled transition; no uncertain retry' using errcode='42501';
end$$;
create or replace function private.list_mail_reviews()
returns table(id uuid,operation text,state text,created_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 if private.is_machine_identity() or not private.is_member() then raise exception 'Mail access denied' using errcode='42501';end if;
 -- Expiry never requeues/reclaims a write. Unfinished claims require human review.
 update private.mail_mutation_reviews r set state=case when r.state='pending' then 'cancelled' else 'uncertain' end where r.owner_email=private.current_email() and r.expires_at<now() and r.state in ('pending','claimed') and r.id in (select e.id from private.mail_mutation_reviews e where e.owner_email=private.current_email() and e.expires_at<now() and e.state in ('pending','claimed') order by e.expires_at desc,e.id limit 100);
 return query select r.id,r.operation,r.state,r.created_at from private.mail_mutation_reviews r where r.owner_email=private.current_email() order by r.created_at desc,r.id limit 25;
end$$;
create or replace function public.list_mail_reviews()
returns table(id uuid,operation text,state text,created_at timestamptz) language plpgsql security invoker set search_path='' as $$
begin
 if (select private.is_machine_identity()) then raise exception 'Mail access denied' using errcode='42501';end if;
 return query select * from private.list_mail_reviews();
end$$;
-- Invoker wrappers: the only Data API exposure. Private helpers operate owner metadata only.
create or replace function public.mail_completion_state() returns boolean language plpgsql security invoker set search_path='' as $$begin if (select private.is_machine_identity()) then raise exception 'Mail access denied' using errcode='42501';end if;return private.mail_completion_state();end$$;
create or replace function public.mail_completion_context() returns jsonb language plpgsql security invoker set search_path='' as $$begin if (select private.is_machine_identity()) then raise exception 'Mail access denied' using errcode='42501';end if;return private.mail_completion_access(false);end$$;
create or replace function public.create_mail_review(p_id uuid,p_operation text,p_revision text,p_connection text,p_draft text default null) returns uuid language plpgsql security invoker set search_path='' as $$begin if (select private.is_machine_identity()) then raise exception 'Mail access denied' using errcode='42501';end if;return private.create_mail_review(p_id,p_operation,p_revision,p_connection,p_draft);end$$;
create or replace function public.advance_mail_review(p_id uuid,p_event text,p_revision text default null) returns text language plpgsql security invoker set search_path='' as $$begin if (select private.is_machine_identity()) then raise exception 'Mail access denied' using errcode='42501';end if;return private.advance_mail_review(p_id,p_event,p_revision);end$$;
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('mail_completion_access','mail_completion_state','create_mail_review','advance_mail_review','mail_schedule_next','mail_completion_context','list_mail_reviews') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end$$;
commit;
