-- Phase 5B: pause first; protected metadata prevents removal.

-- Owner only. Pause is committed BEFORE optional schema repair; never delete protected reviews.
begin;
do $$begin if to_regclass('private.calendar_completion_configuration') is not null then update private.calendar_completion_configuration set enabled=false;end if;end$$;
commit;
begin;
do $$begin
 if to_regclass('private.calendar_mutation_reviews') is not null then
  if exists(select 1 from private.calendar_mutation_reviews) then raise exception 'Phase 5B has protected reviews; remain paused and retain schema';end if;
 end if;
end$$;
-- DROP: only Phase 5B functions; no existing Gmail, Calendar, sync or Auth RPC replaced.
drop function if exists public.list_calendar_reviews();
drop function if exists private.list_calendar_reviews();
drop function if exists public.advance_calendar_review(uuid,text,text);
drop function if exists public.create_calendar_review(uuid,text,text,text,text);
drop function if exists public.calendar_completion_context();
drop function if exists public.calendar_completion_state();
drop function if exists private.advance_calendar_review(uuid,text,text);
drop function if exists private.create_calendar_review(uuid,text,text,text,text);
drop function if exists public.calendar_task_overlay(date,date);
drop function if exists private.calendar_completion_state();
drop function if exists private.calendar_completion_access(boolean);
do $$declare previous text;begin
 if to_regclass('private.calendar_completion_baseline') is not null then
  select permission_check into previous from private.calendar_completion_baseline;
  if previous is null then raise exception 'Missing permission baseline';end if;
  -- DELETE: Phase 5B permission grants only, after the protected-record guard.
  delete from public.member_permissions where permission='calendar_completion';
  -- DROP: restore exact previous permission constraint.
  alter table public.member_permissions drop constraint member_permissions_permission_check;
  execute 'alter table public.member_permissions add constraint member_permissions_permission_check '||previous;
 end if;
end$$;
-- DROP: Phase 5B task read index only.
drop index if exists public.calendar_task_assignee_due;
-- DROP: empty Phase 5B metadata/config tables only; protected records block the script.
drop table if exists private.calendar_mutation_reviews;
drop table if exists private.calendar_completion_configuration;
drop table if exists private.calendar_completion_baseline;
commit;
