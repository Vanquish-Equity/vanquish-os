-- Extend the contextual-comments page allowlist (0021) to cover Boards, the
-- same flat, unpartitioned way "pipeline" already covers every Deal without
-- a per-deal scope: one page_key ('boards') for the list and every board's
-- detail page, with per-card positioning done client-side via target_key.
alter table public.record_comments drop constraint if exists record_comments_context_check;
alter table public.record_comments add constraint record_comments_context_check check (
  (company_id is not null and page_key is null)
  or (company_id is null and deal_id is null and page_key in
    ('home','overview','pipeline','tasks','people','review','companies','boards'))
);

create or replace function private.can_access_context(p_company uuid,p_deal uuid,p_page text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_page is not null then
    p_company is null and p_deal is null and
    p_page in ('home','overview','pipeline','tasks','people','review','companies','boards') and private.is_member()
  else p_company is not null and private.can_access_record(p_company,p_deal) end
$$;

drop policy if exists record_comments_record_select on public.record_comments;
create policy record_comments_record_select on public.record_comments for select to authenticated
using (
  (select private.is_member()) and (
    (page_key is not null and company_id is null and deal_id is null and page_key in
      ('home','overview','pipeline','tasks','people','review','companies','boards'))
    or (page_key is null and company_id is not null
      and exists(select 1 from public.companies c where c.id=record_comments.company_id)
      and (deal_id is null or exists(select 1 from public.deals d where d.id=record_comments.deal_id and d.company_id=record_comments.company_id)))
  )
);
