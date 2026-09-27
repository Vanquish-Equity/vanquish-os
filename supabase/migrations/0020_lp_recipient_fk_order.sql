-- Email draft recipients (0016): make deleting a contact independent of
-- trigger order.
--
-- Deleting a person runs two referential actions on public.people, in the
-- order of their internal trigger names (which follow object ids, so the
-- order differs between databases):
--   * person_emails_person_id_fkey          ON DELETE CASCADE  -> deletes the person's emails
--   * email_draft_recipients_person_id_fkey ON DELETE SET NULL -> flags the recipient
-- When the recipient row was written in the same transaction, the second
-- order re-checks the recipient's person_email_id while it still points to
-- an email being deleted, and the whole delete fails.
--
-- The recipient foreign keys are made DEFERRABLE INITIALLY DEFERRED: the
-- ON DELETE SET NULL actions still run immediately, and only the checks
-- move to commit, when both actions have run. Behaviour is unchanged
-- otherwise: a deleted contact leaves the recipient in its draft with
-- person_id / person_email_id null and the name and address it had when it
-- was selected (flagged for review); drafts and other recipients are kept.
-- An invalid reference is still rejected, at commit.
--
-- Requires 0016. Re-runnable. No data is changed (existing rows are
-- validated when the constraints are recreated).

do $$
begin
  if to_regclass('public.email_draft_recipients') is null then
    raise exception '0020 requires migration 0016';
  end if;
end $$;

alter table public.email_draft_recipients
  drop constraint if exists email_draft_recipients_person_id_fkey,
  drop constraint if exists email_draft_recipients_person_email_id_fkey,
  add constraint email_draft_recipients_person_id_fkey
    foreign key (person_id) references public.people(id)
    on delete set null deferrable initially deferred,
  add constraint email_draft_recipients_person_email_id_fkey
    foreign key (person_email_id) references public.person_emails(id)
    on delete set null deferrable initially deferred;
