-- Run on disposable database after the recipient fields migration.
begin;
create or replace function pg_temp.act(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role','authenticated','email',p_email)::text,true); execute 'set local role authenticated'; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'EMAIL FIELD TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.act(text),pg_temp.expect(boolean,text) to authenticated;
create temporary table email_field_test(draft_id uuid) on commit drop;
grant all on email_field_test to authenticated;
insert into email_field_test default values;
select pg_temp.act('marios@vanquishequity.com');
insert into public.people(name,is_potential_lp) values ('Ordinary recipient',false);
insert into public.person_emails(person_id,email,is_primary)
select id,'ordinary.recipient@example.com',true from public.people where name='Ordinary recipient';
update email_field_test set draft_id=public.save_email_draft(null,'Test','Body',
  (select jsonb_build_array(jsonb_build_object('person_id',id,'field','to')) from public.people where name='Ordinary recipient'));
select pg_temp.expect((select count(*)=1 from public.email_draft_recipients where draft_id=(select draft_id from email_field_test) and field='to'),'ordinary person can be To');
select public.save_email_draft((select draft_id from email_field_test),'Test','Body',
  (select jsonb_build_array(jsonb_build_object('recipient_id',r.id,'person_id',r.person_id,'field','cc')) from public.email_draft_recipients r where r.draft_id=(select draft_id from email_field_test)));
select pg_temp.expect((select count(*)=1 from public.email_draft_recipients where draft_id=(select draft_id from email_field_test) and field='cc'),'saved address moves to CC');
reset role;
rollback;
