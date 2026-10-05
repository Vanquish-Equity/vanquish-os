-- Checks for migration 20261005160000: private company suggestions from a
-- member's own mailbox and the contact-request queue. Run against a
-- disposable database with all migrations applied (never production):
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/email_scouting.sql
-- Everything runs in one transaction that is rolled back.

begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true); execute format('set local role %I',p_role); end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'EMAIL SCOUTING TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members (email, display_name) values
  ('scout.one@vanquishequity.com', 'Scout One'),
  ('scout.two@vanquishequity.com', 'Scout Two')
on conflict (email) do nothing;
insert into public.member_permissions (email, permission) values ('scout.one@vanquishequity.com', 'email_scouting')
on conflict do nothing;
insert into public.ignored_email_domains (domain, reason, created_by) values ('ignored-vendor.com', 'vendor', 'scout.one@vanquishequity.com') on conflict do nothing;
insert into public.people (id, name) values ('00000000-0000-0000-0000-0000000003a1', 'Already Known');
insert into public.person_emails (person_id, email, is_primary) values ('00000000-0000-0000-0000-0000000003a1', 'known@acme-scout.com', true);

select pg_temp.as_user('authenticated','scout.two@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$insert into public.company_suggestions (member_email, domain, suggested_name, first_seen_at, last_seen_at) values ('scout.two@vanquishequity.com','nope.com','Nope',now(),now())$q$),'a member without Email scouting cannot store suggestions');
select pg_temp.expect((select count(*)=0 from public.scouting_ignored_domains()),'ignored domains stay hidden without Email scouting');
reset role;

select pg_temp.as_user('authenticated','scout.one@vanquishequity.com');
select pg_temp.expect((select count(*)=1 from public.scouting_ignored_domains() d where d='ignored-vendor.com'),'scouting members can read the ignored domains');
insert into public.company_suggestions (id, member_email, domain, suggested_name, thread_count, two_way, first_seen_at, last_seen_at, contacts) values
  ('00000000-0000-0000-0000-0000000003b1','scout.one@vanquishequity.com','acme-scout.com','Acme Scout',3,true,now()-interval '5 days',now(),
   '[{"email":"Ana@acme-scout.com","name":"Ana Founder"},{"email":"known@acme-scout.com","name":"Known"},{"email":"bo@acme-scout.com","name":""}]'),
  ('00000000-0000-0000-0000-0000000003b2','scout.one@vanquishequity.com','beta-scout.com','Beta Scout',1,true,now(),now(),
   '[{"email":"cy@beta-scout.com","name":"Cy"}]');
select pg_temp.expect(pg_temp.denied($q$insert into public.company_suggestions (member_email, domain, suggested_name, first_seen_at, last_seen_at) values ('scout.two@vanquishequity.com','other.com','Other',now(),now())$q$),'a member cannot store suggestions for someone else');
select pg_temp.expect(pg_temp.denied($q$update public.company_suggestions set status='accepted' where id='00000000-0000-0000-0000-0000000003b1'$q$) or (select status='open' from public.company_suggestions where id='00000000-0000-0000-0000-0000000003b1'),'a suggestion cannot be marked accepted without creating the company');
select public.accept_company_suggestion('00000000-0000-0000-0000-0000000003b1', 'Acme');
reset role;

select pg_temp.expect((select count(*)=1 from public.companies where name='Acme' and website='https://acme-scout.com'),'accepting creates the company with its domain');
select pg_temp.expect((select count(*)=2 from public.contact_requests where member_email='scout.one@vanquishequity.com' and status='pending'),'default mode queues new contacts as requests, skipping ones already in People');
select pg_temp.expect((select count(*)=0 from public.person_emails where email in ('ana@acme-scout.com','bo@acme-scout.com')),'requested contacts are not in People yet');

select pg_temp.as_user('authenticated','scout.two@vanquishequity.com');
select pg_temp.expect((select count(*)=0 from public.company_suggestions),'suggestions are private to their member');
select pg_temp.expect((select count(*)=0 from public.contact_requests),'contact requests are private to their member');
select pg_temp.expect(pg_temp.denied($q$select public.accept_company_suggestion('00000000-0000-0000-0000-0000000003b2','Beta')$q$),'another member cannot accept someone else''s suggestion');
reset role;

select pg_temp.as_user('authenticated','scout.one@vanquishequity.com');
select public.accept_contact_request((select id from public.contact_requests where email='ana@acme-scout.com'));
update public.contact_requests set status='declined' where email='bo@acme-scout.com';
reset role;
select pg_temp.expect((select p.name='Ana Founder' and p.primary_organization_id=(select id from public.companies where name='Acme') from public.people p join public.person_emails e on e.person_id=p.id where e.email='ana@acme-scout.com'),'accepting a request adds the person to People under the company');
select pg_temp.expect((select count(*)=0 from public.person_emails where email='bo@acme-scout.com'),'a declined request adds nobody');

select pg_temp.as_user('authenticated','scout.one@vanquishequity.com');
insert into public.scouting_settings (member_email, contact_mode) values ('scout.one@vanquishequity.com','auto');
select public.accept_company_suggestion('00000000-0000-0000-0000-0000000003b2', 'Beta');
reset role;
select pg_temp.expect((select count(*)=1 from public.person_emails where email='cy@beta-scout.com'),'auto mode adds contacts straight to People');
rollback;
