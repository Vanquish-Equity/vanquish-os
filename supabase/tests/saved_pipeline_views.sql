-- Checks for migration 20260930120000: saved_views now accepts 'pipeline'
-- as a second object_type, with the same RLS already proven for 'people' in
-- supabase/tests/saved_people_views.sql. Run against a disposable database
-- with all migrations applied (never against production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/saved_pipeline_views.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'SAVED PIPELINE VIEWS TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values
  ('owner.pview@vanquishequity.com', 'Pipeline View Owner')
on conflict (email) do nothing;

select pg_temp.as_user('authenticated','owner.pview@vanquishequity.com');
insert into public.saved_views (object_type,name,owner,is_shared,filters) values
  ('pipeline','My active deals','owner.pview@vanquishequity.com',true,'{"hideTerminal":true,"priority":null,"stage":null}');
insert into public.saved_views (object_type,name,owner,is_shared,filters) values
  ('people','My LP shortlist','owner.pview@vanquishequity.com',false,'{"view":"lps","groupId":null,"q":null}');
select pg_temp.expect((select count(*)=1 from public.saved_views where object_type='pipeline'),'pipeline view saved alongside people views');
select pg_temp.expect(pg_temp.denied($q$insert into public.saved_views (object_type,name,owner) values ('deals','x','owner.pview@vanquishequity.com')$q$),'object_type still rejects an unknown value');
select pg_temp.expect((select count(*)=1 from public.saved_views where object_type='people' and owner='owner.pview@vanquishequity.com'),'people object_type remains usable after widening the constraint');
reset role;
rollback;
