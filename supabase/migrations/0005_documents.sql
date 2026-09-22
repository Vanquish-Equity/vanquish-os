-- Milestone 1.5 — Document attachments.
-- A document belongs to a company, and optionally to a specific deal
-- within that company (e.g. a memo tied to one round vs. a company-level
-- deck). Files live in Supabase Storage bucket "documents"; this table
-- is just the metadata + pointer to the storage object.

create table documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  name text not null,
  storage_path text not null unique,
  content_type text,
  size_bytes bigint,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create index documents_company_id_idx on documents(company_id);
create index documents_deal_id_idx on documents(deal_id);

alter table documents enable row level security;

create policy "authenticated_full_access" on documents
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Temporary anon access while app auth is disabled (mirrors
-- 0003_allow_anon_m1_mutations.sql — same caveat: remove once
-- Google/Microsoft sign-in is wired up and the auth gate is restored).
create policy "anon_documents_select" on documents
  for select to anon using (true);

create policy "anon_documents_insert" on documents
  for insert to anon with check (true);

create policy "anon_documents_delete" on documents
  for delete to anon using (true);

-- Storage bucket for the actual files. Private bucket — files are only
-- reachable through signed URLs the app generates, not a public URL.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Storage RLS: same temporary anon-open policy as the table above, scoped
-- to the "documents" bucket only.
create policy "anon_documents_storage_all"
  on storage.objects
  for all
  to anon
  using (bucket_id = 'documents')
  with check (bucket_id = 'documents');

create policy "authenticated_documents_storage_all"
  on storage.objects
  for all
  to authenticated
  using (bucket_id = 'documents')
  with check (bucket_id = 'documents');
