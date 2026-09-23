-- UX pass data correction and attention snoozes.
-- Additive and re-runnable.

alter table deals add column if not exists attention_snoozed_until timestamptz;
create index if not exists deals_attention_snoozed_until_idx
  on deals(attention_snoozed_until)
  where attention_snoozed_until is not null;

do $$
declare
  expected_names text[] := array[
    'Cartwheel',
    'FoodNerd',
    'Man Cereal',
    'Posana',
    'Simpli',
    'Singing Pastures',
    'Sourmilk',
    'Vaca Chips',
    'Wizard Wellness',
    'Xochi'
  ];
  matching_count int;
  matching_names text[];
begin
  select count(*), coalesce(array_agg(c.name order by c.name), array[]::text[])
  into matching_count, matching_names
  from deals d
  join companies c on c.id = d.company_id
  where d.source_system = 'company_tracker_2025'
    and d.first_seen_at = '2025-02-01'::date
    and d.last_activity_at = '2025-02-01'::timestamptz;

  if matching_count not in (0, 10) then
    raise exception
      'Expected exactly 10 or 0 tracker Feb 2026 typo rows, found %: %',
      matching_count,
      matching_names;
  end if;

  if matching_count = 10 and matching_names <> expected_names then
    raise exception
      'Tracker Feb 2026 typo rows did not match expected companies. Found: %',
      matching_names;
  end if;

  create temp table if not exists _tracker_feb_2026_fix_deals (
    deal_id uuid primary key,
    company_id uuid not null
  ) on commit drop;

  truncate table _tracker_feb_2026_fix_deals;

  insert into _tracker_feb_2026_fix_deals (deal_id, company_id)
  select d.id, d.company_id
  from deals d
  join companies c on c.id = d.company_id
  where d.source_system = 'company_tracker_2025'
    and d.first_seen_at = '2025-02-01'::date
    and d.last_activity_at = '2025-02-01'::timestamptz
    and c.name = any(expected_names);

  insert into activity_events (
    event_type,
    target_type,
    target_id,
    payload,
    actor,
    occurred_at
  )
  select
    'DEAL_FIELD_CHANGED',
    'deal',
    fix.deal_id,
    jsonb_build_object(
      'field', 'first_seen_at,last_activity_at',
      'from', '2025-02-01',
      'to', '2026-02-01',
      'reason', 'tracker typo: status recorded in Feb 2026 column'
    ),
    'migration:data_fix',
    now()
  from _tracker_feb_2026_fix_deals fix;

  update deals d
  set first_seen_at = '2026-02-01'::date,
      last_activity_at = '2026-02-01'::timestamptz
  from _tracker_feb_2026_fix_deals fix
  where d.id = fix.deal_id;

  update companies c
  set last_activity_at = latest.max_last_activity_at
  from (
    select d.company_id, max(d.last_activity_at) as max_last_activity_at
    from deals d
    where d.company_id in (
      select distinct company_id from _tracker_feb_2026_fix_deals
    )
    group by d.company_id
  ) latest
  where c.id = latest.company_id;
end $$;
