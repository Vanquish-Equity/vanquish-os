-- Per-member Google mailbox/calendar connection (OAuth). This is the actual
-- connection storage that docs/settings.md's "Building the actual
-- connection" plan described: a member connects their own Gmail/Calendar
-- from Settings, and only the refresh token needed to act on their behalf
-- is kept, application-encrypted (AES-256-GCM, src/lib/connections/crypto.ts)
-- with a server-only key (MAILBOX_TOKEN_ENCRYPTION_KEY) never exposed to
-- the API. The table itself grants nothing to `authenticated`: every access
-- goes through the narrow functions below, each scoped to
-- private.current_email() only — nobody can read or act on another
-- member's connection, including admins.
--
-- What this migration does NOT do: it does not send mail, read mail, or
-- sync a calendar. It only lets a member's own OAuth grant be stored and
-- later used by that follow-up work (sending, Inbox/Sent, Calendar), which
-- reads the token through the same crypto helper, never through the API.
-- Re-runnable.

create table if not exists public.google_mailbox_connections (
  email text primary key references public.app_members(email) on update cascade on delete cascade,
  granted_scopes text[] not null default '{}',
  refresh_token_encrypted text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_mailbox_connections enable row level security;
revoke all on table public.google_mailbox_connections from public, anon, authenticated;

create or replace function public.set_google_mailbox_connections_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists google_mailbox_connections_touch on public.google_mailbox_connections;
create trigger google_mailbox_connections_touch
  before update on public.google_mailbox_connections
  for each row execute function public.set_google_mailbox_connections_updated_at();

-- Status only (no token material) for the calling member's own connection.
create or replace function public.my_mailbox_connection()
returns table (connected boolean, granted_scopes text[], connected_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select true, c.granted_scopes, c.connected_at
  from public.google_mailbox_connections c
  where c.email = private.current_email()
  union all
  select false, '{}'::text[], null
  where not exists (
    select 1 from public.google_mailbox_connections c
    where c.email = private.current_email()
  )
  limit 1
$$;
revoke all on function public.my_mailbox_connection() from public, anon;
grant execute on function public.my_mailbox_connection() to authenticated;

-- Called only by the OAuth callback route, immediately after exchanging a
-- code for tokens as the signed-in member. Upserts the caller's own row;
-- there is no email parameter, so it can never write another member's row.
create or replace function public.save_mailbox_connection(
  p_granted_scopes text[],
  p_refresh_token_encrypted text,
  p_refresh_token_iv text,
  p_refresh_token_tag text
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_email text := private.current_email();
begin
  if v_email is null or not private.is_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_refresh_token_encrypted is null or p_refresh_token_iv is null or p_refresh_token_tag is null
     or length(p_refresh_token_encrypted) = 0 then
    raise exception 'invalid token payload' using errcode = '22023';
  end if;

  insert into public.google_mailbox_connections
    (email, granted_scopes, refresh_token_encrypted, refresh_token_iv, refresh_token_tag)
  values (v_email, coalesce(p_granted_scopes, '{}'), p_refresh_token_encrypted, p_refresh_token_iv, p_refresh_token_tag)
  on conflict (email) do update
    set granted_scopes = excluded.granted_scopes,
        refresh_token_encrypted = excluded.refresh_token_encrypted,
        refresh_token_iv = excluded.refresh_token_iv,
        refresh_token_tag = excluded.refresh_token_tag;
end $$;
revoke all on function public.save_mailbox_connection(text[], text, text, text) from public, anon;
grant execute on function public.save_mailbox_connection(text[], text, text, text) to authenticated;

create or replace function public.disconnect_mailbox_connection()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.google_mailbox_connections where email = private.current_email();
end $$;
revoke all on function public.disconnect_mailbox_connection() from public, anon;
grant execute on function public.disconnect_mailbox_connection() to authenticated;

-- Server-only accessor for the follow-up work that actually calls Gmail/
-- Calendar (sending, mailbox sync): reads the caller's own encrypted token
-- so it can be decrypted server-side with MAILBOX_TOKEN_ENCRYPTION_KEY.
-- Never exposed to a client bundle; only ever called from a server action
-- or route handler running as the connected member.
create or replace function public.my_mailbox_connection_secret()
returns table (refresh_token_encrypted text, refresh_token_iv text, refresh_token_tag text, granted_scopes text[])
language sql stable security definer
set search_path = ''
as $$
  select c.refresh_token_encrypted, c.refresh_token_iv, c.refresh_token_tag, c.granted_scopes
  from public.google_mailbox_connections c
  where c.email = private.current_email()
$$;
revoke all on function public.my_mailbox_connection_secret() from public, anon;
grant execute on function public.my_mailbox_connection_secret() to authenticated;
