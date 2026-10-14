-- Disposable psql only: prove the full reversal cannot destroy durable LP records.
insert into public.fundraising_funds(id,name,currency) values('af000000-0000-0000-0000-000000000088','Synthetic rollback-preservation fund','USD');
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-2-rollback.sql
\set ON_ERROR_STOP on
do $$begin
 if to_regclass('public.lp_scouting_settings') is null or not exists(select 1 from public.fundraising_funds where id='af000000-0000-0000-0000-000000000088') then raise exception 'LP rollback destroyed durable records';end if;
end$$;
delete from public.fundraising_funds where id='af000000-0000-0000-0000-000000000088';
