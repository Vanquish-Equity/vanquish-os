do $$begin
 if to_regclass('public.weekly_report_requests') is not null or to_regclass('public.fund_metric_reviews') is not null or to_regclass('private.reporting_configuration') is not null or to_regprocedure('public.reporting_overview(date,date,uuid)') is not null then raise exception 'Phase 3 rollback incomplete';end if;
 if to_regclass('public.lp_commitments') is null or to_regprocedure('private.require_worker_identity()') is null then raise exception 'Earlier phase changed by rollback';end if;
end$$;
