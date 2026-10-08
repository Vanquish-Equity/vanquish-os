-- Private threads stay private on reads, replies, edits, resolves and mentions.
alter table public.record_comments add column visible_to text[];
alter table public.record_comments add constraint comment_visibility_size check (visible_to is null or cardinality(visible_to) between 1 and 50);
create function private.can_read_comment(p_id uuid,p_email text default private.current_email())
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_member() and exists(select 1 from public.record_comments c where c.id=p_id
    and (c.visible_to is null or p_email=any(c.visible_to))
    and private.can_access_context(c.company_id,c.deal_id,c.page_key))
$$;
revoke all on function private.can_read_comment(uuid,text) from public,anon,authenticated;
create policy comments_visibility on public.record_comments as restrictive for select to authenticated
  using (visible_to is null or (select private.current_email())=any(visible_to));
create function private.guard_private_comment() returns trigger language plpgsql security definer set search_path='' as $$
declare v_parent public.record_comments%rowtype;
begin
  if tg_op='UPDATE' and current_setting('vanquish.company_merge',true)='1' and private.has_permission('admin') and private.has_permission('documents') and private.has_permission('portfolio') and (to_jsonb(new)-'company_id')=(to_jsonb(old)-'company_id') then return new;end if;
  if tg_op='UPDATE' and not private.can_read_comment(old.id) then raise exception 'comment unavailable' using errcode='42501'; end if;
  if new.parent_id is not null then
    select * into v_parent from public.record_comments where id=new.parent_id;
    if not private.can_read_comment(v_parent.id) then raise exception 'thread unavailable' using errcode='42501'; end if;
    new.visible_to:=v_parent.visible_to;
  end if;
  return new;
end $$;
revoke all on function private.guard_private_comment() from public,anon,authenticated;
create trigger guard_private_comment before insert or update on public.record_comments for each row execute function private.guard_private_comment();
create function private.guard_private_mention() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not private.can_read_comment(new.comment_id,new.member_email) then raise exception 'recipient outside thread' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function private.guard_private_mention() from public,anon,authenticated;
create trigger guard_private_mention before insert or update on public.record_comment_mentions for each row execute function private.guard_private_mention();
create function public.comment_post_visible(
  p_page text,p_company uuid,p_deal uuid,p_parent uuid,p_target text,p_label text,p_snapshot text,p_body text,
  p_mentions text[] default '{}',p_recipients text[] default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_me text:=private.require_member(); v_id uuid; v_recipients text[];
begin
  if p_recipients is not null and p_parent is null then
    v_recipients:=private.comment_mentions(p_recipients,v_me)||array[v_me];
    if cardinality(v_recipients)>50 or not coalesce(p_mentions,'{}') <@ v_recipients then raise exception 'invalid private recipients'; end if;
  end if;
  v_id:=public.comment_post_context(p_page,p_company,p_deal,p_parent,p_target,p_label,p_snapshot,p_body,p_mentions);
  if v_recipients is not null then
    update public.record_comments set visible_to=v_recipients where id=v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.comment_post_visible(text,uuid,uuid,uuid,text,text,text,text,text[],text[]) from public,anon;
grant execute on function public.comment_post_visible(text,uuid,uuid,uuid,text,text,text,text,text[],text[]) to authenticated;

-- Do not publish a private discussion by converting it into a shared task.
create function private.guard_comment_task() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.source_comment_id is not null and exists(select 1 from public.record_comments c where c.id=new.source_comment_id and c.visible_to is not null)
    then raise exception 'private comment cannot create shared task' using errcode='42501'; end if;
  return new;
end $$;
revoke all on function private.guard_comment_task() from public,anon,authenticated;
create trigger guard_comment_task before insert or update on public.tasks for each row execute function private.guard_comment_task();

-- Immutable metadata history; access is inherited from the document, including
-- Portfolio restrictions. History never creates public storage access.
create table public.document_versions (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  revision integer not null, metadata jsonb not null,
  changed_by text, created_at timestamptz not null default now(),
  unique(document_id,revision)
);
alter table public.document_versions enable row level security;
revoke all on public.document_versions from public,anon,authenticated;
grant select on public.document_versions to authenticated;
create policy document_versions_read on public.document_versions for select to authenticated
  using (exists(select 1 from public.documents d where d.id=document_id));
insert into public.document_versions(document_id,revision,metadata)
  select id,1,to_jsonb(d) from public.documents d;
create function private.version_document() returns trigger language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
  if tg_op='UPDATE' and to_jsonb(old)=to_jsonb(new) then return new; end if;
  select coalesce(max(revision),0)+1 into v_revision from public.document_versions where document_id=new.id;
  insert into public.document_versions(document_id,revision,metadata,changed_by)
    values(new.id,v_revision,to_jsonb(new),private.current_email());
  return new;
end $$;
revoke all on function private.version_document() from public,anon,authenticated;
create trigger version_document after insert or update on public.documents for each row execute function private.version_document();
