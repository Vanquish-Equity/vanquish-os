-- PUBLIC execute is inherited by every role, including the machine worker.
-- Preserve the existing anon/member contract explicitly before removing that
-- inheritance. Do not grant a worker membership in anon/authenticated.
do $$declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') loop
    execute format('grant execute on function %s to anon, authenticated',f.signature);
    execute format('revoke execute on function %s from public',f.signature);
  end loop;
end$$;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;
revoke all on all tables in schema public,private,storage from vanquish_worker;
revoke all on all sequences in schema public,private,storage from vanquish_worker;
-- New webhook identity cannot claim leases, obtain OAuth tokens or commit data.
do $$begin
  if not exists(select 1 from pg_roles where rolname='vanquish_gmail_push') then create role vanquish_gmail_push nologin;end if;
  if exists(select 1 from pg_roles where rolname='authenticator') then grant vanquish_gmail_push to authenticator;end if;
end$$;
grant usage on schema public to vanquish_gmail_push;
grant execute on function public.worker_signal_gmail(text,text) to vanquish_gmail_push;

-- Historical originals are SECURITY INVOKER, not definer. Keep that contract.
-- Trigger execution does not need direct callable API grants.
alter function public.update_last_activity_from_interaction() security invoker;
alter function public.update_last_activity_from_interaction() set search_path='';
alter function public.review_requirements_after_document_archive() security invoker;
alter function public.review_requirements_after_document_archive() set search_path='';
revoke all on function public.update_last_activity_from_interaction(),public.review_requirements_after_document_archive() from public,anon,authenticated,vanquish_worker,vanquish_gmail_push;
