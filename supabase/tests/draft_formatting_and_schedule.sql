-- Checks for migration 20260929180000 (rich text body + scheduled send).
--
-- Run against a disposable database with all migrations through this one
-- applied (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/draft_formatting_and_schedule.sql

begin;

create or replace function pg_temp.act(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role','authenticated','email',p_email)::text,true); execute 'set local role authenticated'; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'DRAFT SCHEDULE TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
create or replace function pg_temp.raises(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.act(text), pg_temp.expect(boolean,text), pg_temp.raises(text) to authenticated;

insert into public.app_members (email, display_name) values ('schedule.test@vanquishequity.com', 'Schedule Test')
on conflict (email) do nothing;
update public.app_members set is_active = true where email = 'schedule.test@vanquishequity.com';

select pg_temp.act('schedule.test@vanquishequity.com');

-- A scheduled time in the past (or now) is rejected.
select pg_temp.expect(
  pg_temp.raises($q$select public.save_email_draft(null, 'Past', '<b>hi</b>', '[]'::jsonb, null, now() - interval '1 hour')$q$),
  'scheduling in the past is rejected'
);

-- A future scheduled time is accepted and stored.
create temporary table schedule_test(draft_id uuid) on commit drop;
grant all on schedule_test to authenticated;
insert into schedule_test
select public.save_email_draft(null, 'Future', '<b>hi</b>', '[]'::jsonb, null, now() + interval '1 day');
select pg_temp.expect(
  (select scheduled_at is not null from public.email_drafts where id = (select draft_id from schedule_test)),
  'future schedule is stored'
);

-- Saving again with scheduled_at = null clears it (full replace, like subject/body).
select public.save_email_draft((select draft_id from schedule_test), 'Future', '<b>hi</b>', '[]'::jsonb);
select pg_temp.expect(
  (select scheduled_at is null from public.email_drafts where id = (select draft_id from schedule_test)),
  'omitting scheduled_at on save clears it'
);

-- HTML bodies well beyond the old 100000-char plain-text limit are accepted
-- up to the new 200000-char limit.
select pg_temp.expect(
  not pg_temp.raises(format($q$select public.save_email_draft(null, 'Long', %L, '[]'::jsonb)$q$, repeat('a', 150000))),
  'a body up to 200000 chars is accepted'
);
select pg_temp.expect(
  pg_temp.raises(format($q$select public.save_email_draft(null, 'Too long', %L, '[]'::jsonb)$q$, repeat('a', 200001))),
  'a body over 200000 chars is rejected'
);

reset role;
rollback;
