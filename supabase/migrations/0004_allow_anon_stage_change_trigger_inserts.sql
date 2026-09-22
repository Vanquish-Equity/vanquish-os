-- Temporary M1 write access for the existing deals_log_stage_change trigger.
-- The trigger writes status history and activity events when anon users move
-- a deal between pipeline stages while authentication is disabled.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'deal_status_history'
      and policyname = 'anon_deal_status_history_insert'
  ) then
    execute 'create policy "anon_deal_status_history_insert" on deal_status_history for insert to anon with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_events'
      and policyname = 'anon_activity_events_insert'
  ) then
    execute 'create policy "anon_activity_events_insert" on activity_events for insert to anon with check (true)';
  end if;
end $$;
