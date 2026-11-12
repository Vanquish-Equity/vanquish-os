-- Pin search_path on the two legacy trigger functions flagged by the Supabase
-- security advisor (function_search_path_mutable). Both are SECURITY INVOKER with
-- trivial bodies that only use pg_catalog (always searched), so behavior is unchanged.
begin;
alter function public.set_updated_at() set search_path = '';
alter function public.prevent_deal_status_history_mutation() set search_path = '';
commit;
