-- Task assignees: who a task belongs to, as a Vanquish member.
--
-- tasks.owner is free text ("Mario", "Scott / Pedro", "") and cannot say
-- with certainty whose task it is. Home's "My tasks" needs that certainty,
-- so tasks get an explicit member assignee:
--   assignee_email  an active member (FK to app_members), or null
--   assigned_by     who set it (the signed-in email, set by the database)
--   assigned_at     when it was set
-- tasks.owner stays as a free-text note and is never used to attribute
-- tasks. Existing tasks start unassigned; nothing is inferred from owner.
--
-- Requires 0016 (private.is_active_member). Re-runnable. No data is deleted.

alter table public.tasks add column if not exists assignee_email text;
alter table public.tasks add column if not exists assigned_by text;
alter table public.tasks add column if not exists assigned_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tasks_assignee_email_fkey' and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_assignee_email_fkey
      foreign key (assignee_email) references public.app_members(email)
      on update cascade on delete set null;
  end if;
end $$;

create index if not exists tasks_assignee_open_idx
  on public.tasks (assignee_email, due_at)
  where status = 'open' and archived_at is null;

-- The assignee must be an active member whenever it is set or changed;
-- assigned_by / assigned_at always come from the database.
create or replace function public.guard_task_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.assignee_email := nullif(lower(btrim(coalesce(new.assignee_email, ''))), '');

  if tg_op = 'INSERT' or new.assignee_email is distinct from old.assignee_email then
    if new.assignee_email is not null and not private.is_active_member(new.assignee_email) then
      raise exception 'assignee must be an active member' using errcode = '23514';
    end if;
    new.assigned_by := case when new.assignee_email is null then null else private.current_email() end;
    new.assigned_at := case when new.assignee_email is null then null else now() end;
  else
    new.assigned_by := old.assigned_by;
    new.assigned_at := old.assigned_at;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_guard_assignee on public.tasks;
create trigger tasks_guard_assignee
  before insert or update on public.tasks
  for each row execute function public.guard_task_assignee();

revoke execute on function public.guard_task_assignee() from public, anon;
