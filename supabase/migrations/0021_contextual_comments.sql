-- Semantic anchors for comments in shared workspace pages. Depends on 0019.
-- Existing Company/Deal comments remain unchanged. No data is removed.
do $$ begin
  if to_regclass('public.record_comments') is null then
    raise exception '0021 requires migration 0019';
  end if;
end $$;

alter table public.record_comments alter column company_id drop not null;
alter table public.record_comments add column if not exists page_key text;
alter table public.record_comments add column if not exists target_key text;
alter table public.record_comments add column if not exists target_label text;
alter table public.record_comments add column if not exists value_snapshot text;
alter table public.record_comments add column if not exists resolved_at timestamptz;
alter table public.record_comments add column if not exists resolved_by text references public.app_members(email) on update cascade;

alter table public.record_comments drop constraint if exists record_comments_context_check;
alter table public.record_comments add constraint record_comments_context_check check (
  (company_id is not null and page_key is null)
  or (company_id is null and deal_id is null and page_key in
    ('home','overview','pipeline','tasks','people','review','companies'))
);
alter table public.record_comments drop constraint if exists record_comments_target_check;
alter table public.record_comments add constraint record_comments_target_check check (
  (target_key is null or char_length(target_key) between 1 and 140)
  and (target_label is null or char_length(target_label) <= 140)
  and (value_snapshot is null or char_length(value_snapshot) <= 500)
);
create index if not exists record_comments_page_idx on public.record_comments(page_key,created_at)
  where page_key is not null;

create or replace function private.can_access_context(p_company uuid,p_deal uuid,p_page text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_page is not null then
    p_company is null and p_deal is null and
    p_page in ('home','overview','pipeline','tasks','people','review','companies') and private.is_member()
  else p_company is not null and private.can_access_record(p_company,p_deal) end
$$;
revoke all on function private.can_access_context(uuid,uuid,text) from public,anon;
grant execute on function private.can_access_context(uuid,uuid,text) to authenticated;

drop policy if exists record_comments_record_select on public.record_comments;
create policy record_comments_record_select on public.record_comments for select to authenticated
using (
  (select private.is_member()) and (
    (page_key is not null and company_id is null and deal_id is null and page_key in
      ('home','overview','pipeline','tasks','people','review','companies'))
    or (page_key is null and company_id is not null
      and exists(select 1 from public.companies c where c.id=record_comments.company_id)
      and (deal_id is null or exists(select 1 from public.deals d where d.id=record_comments.deal_id and d.company_id=record_comments.company_id)))
  )
);

-- New anchored threads. Parent replies inherit the root's semantic anchor.
-- The browser cannot choose an arbitrary URL or grant access through a mention.
create or replace function public.comment_post_context(
  p_page text,p_company uuid,p_deal uuid,p_parent uuid,
  p_target text,p_label text,p_snapshot text,p_body text,p_mentions text[] default '{}'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me text := private.require_member();
  v_body text := btrim(coalesce(p_body,''));
  v_target text := btrim(coalesce(p_target,''));
  v_label text := btrim(coalesce(p_label,''));
  v_mentions text[];
  v_root public.record_comments%rowtype;
  v_id uuid;
begin
  if not private.can_access_context(p_company,p_deal,p_page) then
    raise exception 'comment target not available' using errcode='42501';
  end if;
  if char_length(v_body) not between 1 and 4000 or char_length(v_target) not between 1 and 140
    or char_length(v_label) not between 1 and 140 or char_length(coalesce(p_snapshot,''))>500
    or v_target !~ '^[a-zA-Z0-9:_-]+$' then
    raise exception 'invalid comment or target' using errcode='22023';
  end if;
  v_mentions := private.comment_mentions(p_mentions,v_me);
  if p_parent is not null then
    select * into v_root from public.record_comments where id=p_parent;
    if v_root.parent_id is not null then
      select * into v_root from public.record_comments where id=v_root.parent_id;
    end if;
    if v_root.id is null or v_root.deleted_at is not null
      or v_root.company_id is distinct from p_company or v_root.deal_id is distinct from p_deal
      or v_root.page_key is distinct from p_page or v_root.target_key is distinct from v_target then
      raise exception 'comment target not available' using errcode='42501';
    end if;
  end if;
  insert into public.record_comments
    (company_id,deal_id,page_key,parent_id,target_key,target_label,value_snapshot,author_email,body)
  values (p_company,p_deal,p_page,v_root.id,v_target,v_label,nullif(p_snapshot,''),v_me,v_body)
  returning id into v_id;
  insert into public.record_comment_mentions(comment_id,member_email)
    select v_id,e from unnest(v_mentions) e;
  insert into public.notifications(recipient_email,kind,actor_email,comment_id,dedupe_key)
    select e,'comment_mention',v_me,v_id,'comment:'||v_id||':mention' from unnest(v_mentions)e
    on conflict(recipient_email,dedupe_key) do nothing;
  if v_root.id is not null and v_root.author_email <> v_me
    and not (v_root.author_email=any(v_mentions)) and private.is_active_member(v_root.author_email) then
    insert into public.notifications(recipient_email,kind,actor_email,comment_id,dedupe_key)
      values(v_root.author_email,'comment_reply',v_me,v_id,'comment:'||v_id||':reply')
      on conflict(recipient_email,dedupe_key) do nothing;
  end if;
  return v_id;
end $$;
revoke all on function public.comment_post_context(text,uuid,uuid,uuid,text,text,text,text,text[]) from public,anon;
grant execute on function public.comment_post_context(text,uuid,uuid,uuid,text,text,text,text,text[]) to authenticated;

-- Resolve/reopen the root without deleting its discussion.
create or replace function public.comment_set_resolved(p_comment uuid,p_resolved boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_root public.record_comments%rowtype;
begin
  perform private.require_member();
  select * into v_root from public.record_comments where id=p_comment;
  if v_root.id is null or v_root.parent_id is not null or v_root.deleted_at is not null
    or not private.can_access_context(v_root.company_id,v_root.deal_id,v_root.page_key) then
    raise exception 'comment not available' using errcode='42501';
  end if;
  update public.record_comments set
    resolved_at=case when p_resolved then now() else null end,
    resolved_by=case when p_resolved then private.current_email() else null end
  where id=p_comment;
end $$;
revoke all on function public.comment_set_resolved(uuid,boolean) from public,anon;
grant execute on function public.comment_set_resolved(uuid,boolean) to authenticated;

-- Replies made from the existing Company/Deal Comments section inherit an
-- anchored thread's location, so they also appear at its pin.
create or replace function private.inherit_comment_anchor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent public.record_comments%rowtype;
begin
  if new.parent_id is null then return new; end if;
  select * into v_parent from public.record_comments where id=new.parent_id;
  if v_parent.target_key is not null then
    if new.company_id is distinct from v_parent.company_id or new.deal_id is distinct from v_parent.deal_id
      or new.page_key is distinct from v_parent.page_key then
      raise exception 'reply target mismatch' using errcode='42501';
    end if;
    new.target_key := v_parent.target_key;
    new.target_label := v_parent.target_label;
    new.value_snapshot := v_parent.value_snapshot;
  end if;
  return new;
end $$;
revoke all on function private.inherit_comment_anchor() from public,anon,authenticated;
drop trigger if exists inherit_comment_anchor on public.record_comments;
create trigger inherit_comment_anchor before insert on public.record_comments
for each row execute function private.inherit_comment_anchor();

-- Existing edit/delete RPCs are redefined below to recognize page comments.

create or replace function public.comment_edit(p_comment uuid, p_body text, p_mentions text[] default '{}')
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.record_comments%rowtype;
  v_mentions text[];
begin
  select * into v_row from public.record_comments where id = p_comment;
  if v_row.id is null or v_row.author_email <> v_me or v_row.deleted_at is not null
     or not private.can_access_context(v_row.company_id, v_row.deal_id, v_row.page_key) then
    raise exception 'only the author can edit this comment' using errcode = '42501';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'comment must be 1 to 4000 characters' using errcode = '22023';
  end if;
  v_mentions := private.comment_mentions(p_mentions, v_me);

  if v_body is distinct from v_row.body then
    update public.record_comments set body = v_body, edited_at = now() where id = p_comment;
  end if;

  delete from public.notifications n
  where n.comment_id = p_comment and n.kind = 'comment_mention' and n.read_at is null
    and not (n.recipient_email = any (v_mentions));
  delete from public.record_comment_mentions m
  where m.comment_id = p_comment and not (m.member_email = any (v_mentions));

  insert into public.record_comment_mentions (comment_id, member_email)
  select p_comment, e from unnest(v_mentions) e
  on conflict do nothing;
  insert into public.notifications (recipient_email, kind, actor_email, comment_id, dedupe_key)
  select e, 'comment_mention', v_me, p_comment, 'comment:' || p_comment || ':mention'
  from unnest(v_mentions) e
  on conflict (recipient_email, dedupe_key) do nothing;
end;
$$;



create or replace function public.comment_delete(p_comment uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_me text := private.require_member();
  v_row public.record_comments%rowtype;
begin
  select * into v_row from public.record_comments where id = p_comment;
  if v_row.id is null or v_row.author_email <> v_me or v_row.deleted_at is not null
     or not private.can_access_context(v_row.company_id, v_row.deal_id, v_row.page_key) then
    raise exception 'only the author can delete this comment' using errcode = '42501';
  end if;
  delete from public.notifications where comment_id = p_comment;
  delete from public.record_comment_mentions where comment_id = p_comment;
  update public.record_comments set body = '', deleted_at = now() where id = p_comment;
end;
$$;
