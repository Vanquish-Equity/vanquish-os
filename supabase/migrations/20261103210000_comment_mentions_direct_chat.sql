begin;

alter table public.chat_messages add column comment_mention_id uuid
  references public.record_comments(id) on delete cascade;
create unique index chat_messages_comment_mention_once
  on public.chat_messages(comment_mention_id, conversation_id)
  where comment_mention_id is not null;

create function private.can_read_comment_mention_message(p_comment uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not private.is_machine_identity()
    and private.can_read_comment(p_comment)
    and exists (select 1 from public.record_comments where id = p_comment and deleted_at is null)
$$;
revoke all on function private.can_read_comment_mention_message(uuid) from public, anon, authenticated;
grant execute on function private.can_read_comment_mention_message(uuid) to authenticated;
create policy chat_comment_mention_source_read on public.chat_messages as restrictive
  for select to authenticated
  using (case when comment_mention_id is null then true
    else (select private.can_read_comment_mention_message(comment_mention_id)) end);

create function private.deliver_comment_mention_to_direct_chat()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.record_comments%rowtype;
  v_chat uuid;
  v_board uuid;
  v_path text;
  v_at timestamptz;
begin
  select * into c from public.record_comments where id = new.comment_id and deleted_at is null;
  if c.id is null or c.author_email is distinct from private.current_email()
    or c.author_email = new.member_email or private.is_machine_identity()
    or not private.can_read_comment(c.id, c.author_email)
    or not private.can_read_comment(c.id, new.member_email)
    or not exists (select 1 from public.record_comment_mentions m
      where m.comment_id = c.id and m.member_email = new.member_email)
  then return null; end if;

  v_board := case when c.page_key = 'boards' then private.comment_board_id(c.target_key) end;
  v_path := case when v_board is not null then '/boards/' || v_board
    when c.page_key is not null then '/' || c.page_key
    when c.deal_id is not null then '/companies/' || c.company_id || '/deals/' || c.deal_id
    else '/companies/' || c.company_id end;
  if v_path is null then return null; end if;

  v_chat := public.chat_start_direct(new.member_email);
  -- The comment already creates the recipient's bell notice. Write a single
  -- link-only chat entry without creating a second bell notice or marking old chat as read.
  insert into public.chat_messages(conversation_id, author_email, body, comment_mention_id)
  values (v_chat, c.author_email, 'Comment mention: ' || v_path || '#comment-' || c.id, c.id)
  on conflict (comment_mention_id, conversation_id) where comment_mention_id is not null do nothing
  returning created_at into v_at;
  if v_at is not null then
    update public.chat_conversations set last_message_at = greatest(last_message_at, v_at) where id = v_chat;
  end if;
  return null;
end;
$$;
revoke all on function private.deliver_comment_mention_to_direct_chat() from public, anon, authenticated;

-- comment_post_visible sets its final audience after inserting the mentions.
create constraint trigger deliver_comment_mention_to_direct_chat
  after insert on public.record_comment_mentions
  deferrable initially deferred for each row
  execute function private.deliver_comment_mention_to_direct_chat();

commit;
