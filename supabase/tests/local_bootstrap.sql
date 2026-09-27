-- Minimal Supabase-owned schemas for disposable PostgreSQL CI only.
-- Never run against a real Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.role() returns text language sql stable as $$
  select auth.jwt()->>'role'
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub','')::uuid
$$;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean not null default false);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated;
grant execute on function auth.jwt(),auth.role(),auth.uid() to anon,authenticated;
grant select,insert,delete on storage.objects to authenticated;
-- Supabase grants authenticated table access by default; RLS and later
-- migrations narrow it per object. Plain PostgreSQL needs that baseline.
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant usage on sequences to authenticated;
