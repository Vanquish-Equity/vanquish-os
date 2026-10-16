-- Owner only. Pause is committed BEFORE optional schema repair; never delete protected reviews.
begin;
do $$begin if to_regclass('private.mail_completion_configuration') is not null then update private.mail_completion_configuration set enabled=false;end if;end$$;
commit;
begin;
do $$begin
 if to_regclass('private.mail_mutation_reviews') is not null then
  if exists(select 1 from private.mail_mutation_reviews) or exists(select 1 from private.mail_scheduled_design) then raise exception 'Phase 5A has protected reviews; remain paused and retain schema';end if;
 end if;
end$$;
-- DROP: only Phase 5A functions; no existing Gmail, Calendar, sync or Auth RPC replaced.
drop function if exists public.list_mail_reviews();
drop function if exists private.list_mail_reviews();
drop function if exists public.advance_mail_review(uuid,text,text);
drop function if exists public.create_mail_review(uuid,text,text,text,text);
drop function if exists public.mail_completion_context();
drop function if exists public.mail_completion_state();
drop function if exists private.advance_mail_review(uuid,text,text);
drop function if exists private.create_mail_review(uuid,text,text,text,text);
drop function if exists private.mail_schedule_next(text,text,boolean);
drop function if exists private.mail_completion_state();
drop function if exists private.mail_completion_access(boolean);
do $$declare previous text;begin
 if to_regclass('private.mail_completion_baseline') is not null then
  select permission_check into previous from private.mail_completion_baseline;
  if previous is null then raise exception 'Missing permission baseline';end if;
  -- DELETE: Phase 5A permission grants only, after the protected-record guard.
  delete from public.member_permissions where permission='mail_completion';
  -- DROP: restore exact previous permission constraint.
  alter table public.member_permissions drop constraint member_permissions_permission_check;
  execute 'alter table public.member_permissions add constraint member_permissions_permission_check '||previous;
 end if;
end$$;
-- DROP: empty Phase 5A metadata/config tables only; protected records block the script.
drop table if exists private.mail_mutation_reviews;
drop table if exists private.mail_scheduled_design;
drop table if exists private.mail_completion_configuration;
drop table if exists private.mail_completion_baseline;
commit;
