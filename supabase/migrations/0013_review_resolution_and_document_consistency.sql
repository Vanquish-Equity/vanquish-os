-- Resolve tracker duplicates and update the selected deal in one transaction.
-- SECURITY INVOKER preserves the existing RLS policies. Remove anon access
-- together with the temporary anon policies when the auth gate is enabled.
create or replace function public.resolve_duplicate_tracker_review(
  p_review_item_id uuid,
  p_action text,
  p_archive_deal_id uuid default null
) returns boolean
language plpgsql security invoker set search_path = public
as $$
declare
  item record;
  selected_company_id uuid;
  other_company_id uuid;
  affected integer;
  event_actor text := coalesce(auth.jwt()->>'email', 'anonymous');
begin
  if p_action not in ('separate', 'duplicate_archive_one', 'ignore') then
    raise exception 'Unsupported review action';
  end if;

  select * into item from review_items where id = p_review_item_id for update;
  if not found or item.status <> 'open' then return false; end if;
  if item.review_type <> 'duplicate_tracker_row' then
    raise exception 'This action only applies to tracker duplicate reviews';
  end if;

  if p_action = 'duplicate_archive_one' then
    if p_archive_deal_id is null or not exists (
      select 1 from jsonb_array_elements(coalesce(item.payload->'deals', '[]'::jsonb)) d
      where d->>'deal_id' = p_archive_deal_id::text
    ) then
      raise exception 'Choose one of the deals in this review item';
    end if;

    select company_id into selected_company_id
      from deals where id = p_archive_deal_id and archived_at is null for update;
    if selected_company_id is null then
      raise exception 'The selected deal is already archived or unavailable';
    end if;
    select d.company_id into other_company_id
      from deals d
      join lateral jsonb_array_elements(coalesce(item.payload->'deals', '[]'::jsonb)) r
        on r->>'deal_id' = d.id::text
      where d.id <> p_archive_deal_id and d.archived_at is null
      limit 1;
    if other_company_id is distinct from selected_company_id then
      raise exception 'The other opportunity must remain active under the same company';
    end if;

    update deals set archived_at = now() where id = p_archive_deal_id and archived_at is null;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Could not archive selected deal'; end if;

    insert into activity_events (event_type, target_type, target_id, payload, actor)
    values ('DEAL_ARCHIVED', 'deal', p_archive_deal_id,
      jsonb_build_object('reviewItemId', p_review_item_id, 'reason', 'duplicate_tracker_row'), event_actor);
  elsif p_archive_deal_id is not null then
    raise exception 'A deal may only be archived for the duplicate action';
  end if;

  update review_items set
    status = case when p_action = 'ignore' then 'ignored' else 'resolved' end,
    resolution = jsonb_build_object('action', p_action, 'archived_deal_id', p_archive_deal_id),
    resolved_at = now()
    where id = p_review_item_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Could not resolve review item'; end if;

  insert into activity_events (event_type, target_type, target_id, payload, actor)
  values ('REVIEW_RESOLVED', 'review_item', p_review_item_id,
    jsonb_build_object('action', p_action, 'archivedDealId', p_archive_deal_id), event_actor);
  return true;
end;
$$;

grant execute on function public.resolve_duplicate_tracker_review(uuid, text, uuid)
  to anon, authenticated;

-- A file removed from the active document list cannot continue satisfying a
-- checklist item. Keep a visible Needs review state for the human reviewer.
create or replace function public.review_requirements_after_document_archive()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    update document_requirements
      set satisfied_by_document_id = null, status = 'needs_review'
      where satisfied_by_document_id = new.id and archived_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_review_archived_requirements on documents;
create trigger documents_review_archived_requirements
  after update of archived_at on documents
  for each row execute function public.review_requirements_after_document_archive();
