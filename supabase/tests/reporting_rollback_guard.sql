-- Disposable only. Full rollback refuses explicit financial review records.
insert into public.fundraising_funds(id,name,currency) values('f3200000-0000-0000-0000-000000000001','Synthetic protected review fund','USD');
insert into public.fund_metric_reviews(fund_id,as_of,basis,currency) values('f3200000-0000-0000-0000-000000000001',current_date,'net','USD');
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-3-rollback.sql
\set ON_ERROR_STOP on
do $$begin if not exists(select 1 from public.fund_metric_reviews where fund_id='f3200000-0000-0000-0000-000000000001') then raise exception 'Rollback discarded metric review';end if;end$$;
-- DELETE: synthetic fixture cleanup only.
delete from public.fund_metric_reviews where fund_id='f3200000-0000-0000-0000-000000000001';
delete from public.fundraising_funds where id='f3200000-0000-0000-0000-000000000001';
