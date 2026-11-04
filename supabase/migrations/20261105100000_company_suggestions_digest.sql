begin;

alter table public.notifications
  add column if not exists company_suggestions_count integer;

-- Preserve all 20261104150000 kinds and target rules. Only the digest has a
-- count and it carries no actor, company, contact, or mailbox references.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications drop constraint if exists notifications_target_check;
alter table public.notifications add constraint notifications_kind_check check (
  kind in ('chat_direct','chat_mention','chat_group','task_assigned','draft_assigned',
           'comment_mention','comment_reply','contact_reminder','contact_note_tag',
           'company_suggestions_digest'));
alter table public.notifications add constraint notifications_target_check check (
  (
    company_suggestions_count is null
    and (
      (kind like 'chat\_%' and conversation_id is not null and message_id is not null)
      or (kind = 'task_assigned' and task_id is not null)
      or (kind = 'draft_assigned' and draft_id is not null)
      or (kind like 'comment\_%' and comment_id is not null)
      or (kind = 'contact_reminder' and contact_reminder_id is not null and person_id is not null)
      or (kind = 'contact_note_tag' and person_id is not null)
    )
  )
  or (
    kind = 'company_suggestions_digest'
    and company_suggestions_count is not null and company_suggestions_count > 0
    and actor_email is null and conversation_id is null and message_id is null
    and task_id is null and draft_id is null and comment_id is null
    and person_id is null and contact_reminder_id is null
  )
);

-- Only successful inserts by the owner increase their daily count. The
-- database clock and unique notification key serialize concurrent scans;
-- refreshing an existing suggestion or retrying its insert adds nothing.
create or replace function private.notify_company_suggestion_added() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_owner text := private.current_email();
  v_day date := (statement_timestamp() at time zone 'UTC')::date;
begin
  if new.member_email = v_owner and new.status = 'open'
     and private.is_member() and not private.is_machine_identity()
     and private.has_permission('email_scouting') then
    insert into public.notifications as n (recipient_email, kind, dedupe_key, company_suggestions_count)
    values (v_owner, 'company_suggestions_digest', 'company_suggestions_digest:' || to_char(v_day, 'YYYY-MM-DD'), 1)
    on conflict (recipient_email, dedupe_key) do update
      set company_suggestions_count = n.company_suggestions_count + 1,
          read_at = null
      where n.kind = 'company_suggestions_digest';
  end if;
  return null;
end
$$;
revoke all on function private.notify_company_suggestion_added() from public, anon, authenticated;
drop trigger if exists company_suggestions_notify_added on public.company_suggestions;
create trigger company_suggestions_notify_added after insert on public.company_suggestions
  for each row execute function private.notify_company_suggestion_added();

commit;
