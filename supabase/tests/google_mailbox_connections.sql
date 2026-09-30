-- Checks for migration 20260929200000 (Google mailbox connection storage).
-- Disposable database only; run after 0015_auth_members_and_rls.sql.

begin;
insert into public.app_members(email,display_name) values
  ('mailbox-a@vanquishequity.com','A'),
  ('mailbox-b@vanquishequity.com','B')
on conflict (email) do nothing;
update public.app_members set is_active = true where email in ('mailbox-a@vanquishequity.com','mailbox-b@vanquishequity.com');

create or replace function pg_temp.act(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role','authenticated','email',p_email)::text,true); execute 'set local role authenticated'; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'MAILBOX CONNECTION TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.act(text), pg_temp.expect(boolean,text), pg_temp.denied(text) to authenticated;

select pg_temp.act('mailbox-a@vanquishequity.com');
select pg_temp.expect((select connected=false from public.my_mailbox_connection()),'not connected before saving');
select public.save_mailbox_connection(array['gmail.send','gmail.readonly'],'ciphertext-a','iv-a','tag-a');
select pg_temp.expect((select connected=true and granted_scopes=array['gmail.send','gmail.readonly'] from public.my_mailbox_connection()),'connection saved and reported back');
select pg_temp.expect((select refresh_token_encrypted='ciphertext-a' from public.my_mailbox_connection_secret()),'secret accessor returns the caller''s own encrypted token');
-- Re-saving (reconnect / refreshed scopes) replaces the row rather than erroring.
select public.save_mailbox_connection(array['gmail.send'],'ciphertext-a2','iv-a2','tag-a2');
select pg_temp.expect((select refresh_token_encrypted='ciphertext-a2' from public.my_mailbox_connection_secret()),'reconnecting replaces the stored token');
reset role;
-- Privileged check (authenticated has no direct table access, by design).
select pg_temp.expect((select count(*) from public.google_mailbox_connections)=1,'still exactly one row for this member');

select pg_temp.act('mailbox-b@vanquishequity.com');
select pg_temp.expect((select connected=false from public.my_mailbox_connection()),'a different member sees no connection');
select pg_temp.expect((select count(*) from public.my_mailbox_connection_secret())=0,'a different member gets no secret rows');
select pg_temp.expect(pg_temp.denied($q$select * from public.google_mailbox_connections$q$),'no direct table access even to authenticated');
select public.disconnect_mailbox_connection();
reset role;
select pg_temp.expect((select count(*) from public.google_mailbox_connections where email='mailbox-a@vanquishequity.com')=1,'disconnecting as B does not touch A''s row');

select pg_temp.act('mailbox-a@vanquishequity.com');
select public.disconnect_mailbox_connection();
select pg_temp.expect((select connected=false from public.my_mailbox_connection()),'A can disconnect their own connection');
reset role;

rollback;
