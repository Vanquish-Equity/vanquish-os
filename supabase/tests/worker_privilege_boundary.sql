begin;
create function pg_temp.expect(ok boolean,label text)returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'PRIVILEGE TEST: %',label;end if;end$$;
select pg_temp.expect(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and has_function_privilege('vanquish_worker',p.oid,'execute') and p.proname not like 'worker\_%' escape '\' and p.proname<>'resolve_sync_event'),'worker RPC allowlist');
select pg_temp.expect(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','v','m','p') and has_table_privilege('vanquish_worker',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),'worker cannot directly access ANY business, private or Storage table/view');
select pg_temp.expect(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and has_function_privilege('vanquish_gmail_push',p.oid,'execute') and p.proname<>'worker_signal_gmail'),'push identity can only signal');
select pg_temp.expect(has_function_privilege('vanquish_gmail_push','public.worker_signal_gmail(text,text)','execute'),'push may signal');
select pg_temp.expect(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind in ('r','v','m','p') and has_table_privilege('vanquish_gmail_push',c.oid,'SELECT,INSERT,UPDATE,DELETE')),'push cannot access tables');
select pg_temp.expect(not exists(select 1 from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where m.rolname in ('vanquish_worker','vanquish_gmail_push')),'machine identities inherit no roles');
do $$declare f regprocedure;begin
  foreach f in array array['public.update_last_activity_from_interaction()'::regprocedure,'public.review_requirements_after_document_archive()'::regprocedure] loop
    perform pg_temp.expect((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=f),'historical invoker mode and empty search path');
    perform pg_temp.expect(not has_function_privilege('anon',f,'execute') and not has_function_privilege('authenticated',f,'execute') and not has_function_privilege('vanquish_worker',f,'execute'),'trigger functions are not API endpoints');
  end loop;
end$$;
rollback;
