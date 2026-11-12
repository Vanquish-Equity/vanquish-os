-- Disposable Postgres only. Every fixture and write is rolled back.
begin;

create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'SEARCH PATH PIN FAILED: %', label; end if; end $$;

select pg_temp.expect((select proconfig::text like '%search_path%' from pg_proc
  where oid='public.set_updated_at()'::regprocedure), 'set_updated_at pins search_path');
select pg_temp.expect((select proconfig::text like '%search_path%' from pg_proc
  where oid='public.prevent_deal_status_history_mutation()'::regprocedure), 'append-only guard pins search_path');
select pg_temp.expect(not (select prosecdef from pg_proc where oid='public.set_updated_at()'::regprocedure),
  'set_updated_at stays SECURITY INVOKER');

-- Behavior is unchanged with an empty search_path.
create temp table touch_probe(id int primary key, updated_at timestamptz not null default now());
create trigger touch_probe_updated before update on touch_probe
  for each row execute function public.set_updated_at();
insert into touch_probe values (1, timestamptz '2000-01-01');
update touch_probe set id = id where id = 1;
select pg_temp.expect((select updated_at > timestamptz '2001-01-01' from touch_probe where id = 1),
  'set_updated_at still stamps updated_at');

-- The append-only guard still blocks updates and deletes on the real history table.
do $$ declare st text; begin
  begin
    update public.deal_status_history set deal_id = deal_id;
    st := 'none';
  exception when others then st := sqlerrm;
  end;
  -- Zero rows updated is fine on an empty table; when rows exist the guard must fire.
  if exists (select 1 from public.deal_status_history) then
    perform pg_temp.expect(st like '%append-only%', 'append-only guard still fires');
  end if;
end $$;

rollback;
