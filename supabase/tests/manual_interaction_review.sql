-- Run only in a disposable database after 0024.
begin;
create or replace function pg_temp.as_user(p_role text,p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',json_build_object('role',p_role,'email',p_email)::text,true);
  execute format('set local role %I',p_role);
end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'MANUAL REVIEW TEST FAILED: %',label; end if;
raise notice 'ok - %',label; end $$;
grant execute on function pg_temp.as_user(text,text),pg_temp.denied(text),pg_temp.expect(boolean,text) to anon,authenticated;

insert into public.app_members(email,display_name) values ('manual-tester@example.com','Tester');
insert into public.companies(name) values ('Test Blue Oaks'),('Test Birch Oaks'),('Test Empty Oak');
insert into public.people(name,primary_organization_id) values
  ('Test contact',(select id from public.companies where name='Test Blue Oaks'));
insert into public.person_emails(person_id,email) values
  ((select id from public.people where name='Test contact'),'contact@blue-oaks.example');
insert into public.company_domains(company_id,domain,verified) values
  ((select id from public.companies where name='Test Blue Oaks'),'blue-oaks.example',true);
insert into public.ignored_email_domains(domain,reason,created_by) values ('legal.example','Test ignored legal','marios@vanquishequity.com');

select pg_temp.as_user('anon','anon@example.com');
select pg_temp.expect(pg_temp.denied($q$select public.propose_manual_interaction('','email',now(),'Test','',array['a@unknown.example'])$q$),'anonymous cannot propose');
select pg_temp.expect(pg_temp.denied($q$select public.log_manual_interaction(null,null,'email',now(),'Test','',array['a@unknown.example'])$q$),'anonymous cannot log');
select pg_temp.expect(pg_temp.denied($q$select * from public.interaction_participants$q$),'anonymous cannot read participants');
reset role;

select pg_temp.as_user('authenticated','external@example.com');
select pg_temp.expect(pg_temp.denied($q$select public.propose_manual_interaction('','email',now(),'Test','',array['a@unknown.example'])$q$),'nonmember cannot propose');
reset role;

select pg_temp.as_user('authenticated','manual-tester@example.com');
select pg_temp.expect(pg_temp.denied($q$insert into public.interaction_participants(interaction_id,email) values (gen_random_uuid(),'forged@example.com')$q$),'members cannot forge participant joins');
select pg_temp.expect((public.propose_manual_interaction('','email',now(),'Known person','',array['contact@blue-oaks.example'])->>'status')='attached','known person attaches');
select pg_temp.expect((public.propose_manual_interaction('','email',now(),'Known domain','',array['other@blue-oaks.example'])->>'status')='attached','verified domain attaches');
select pg_temp.expect((select count(*) from public.interaction_participants where email='contact@blue-oaks.example')=1,'participant recorded once');
select pg_temp.expect((select count(*) from public.interactions where subject='Known person' and created_by='manual-tester@example.com')=1,'author attributed to logged in member');
select pg_temp.expect((public.propose_manual_interaction('','email',now(),'Legal','',array['lawyer@legal.example'])->>'status')='ignored','ignored domain creates nothing');
select pg_temp.expect((select count(*) from public.review_items where review_type='manual_interaction_match')=0,'ignored domain not queued');
select pg_temp.expect((public.propose_manual_interaction('Test Blue Oaks','email',now(),'Conflicting','',array['contact@blue-oaks.example','other@birch-oaks.example'])->>'status')='attached','unverified second domain does not override confirmed identity');
select pg_temp.expect((public.propose_manual_interaction('Possible Test Birch','email',now(),'Needs decision','',array['new@birch-oaks.example'])->>'status')='review','unknown company requires decision');
select pg_temp.expect((select count(*) from public.interactions where subject='Needs decision')=0,'unresolved item did not create interaction');
select pg_temp.expect(pg_temp.denied($q$select public.resolve_manual_interaction((select id from public.review_items where payload->>'subject'='Needs decision'), 'link', (select id from public.companies where name='Test Blue Oaks'), null, 'gmail.com')$q$),'public email domain cannot be learned');
select pg_temp.expect((select status from public.review_items where payload->>'subject'='Needs decision')='open','invalid decision is atomic');
select public.resolve_manual_interaction((select id from public.review_items where payload->>'subject'='Needs decision'), 'link',
  (select id from public.companies where name='Test Birch Oaks'), null, 'birch-oaks.example');
select pg_temp.expect((select verified from public.company_domains where domain='birch-oaks.example'),'confirmed domain learned');
select pg_temp.expect((public.propose_manual_interaction('','email',now(),'Later reply','',array['reply@birch-oaks.example'])->>'status')='attached','future interaction matches learned domain');
select pg_temp.expect(pg_temp.denied($q$select public.resolve_manual_interaction((select id from public.review_items where payload->>'subject'='Needs decision'),'create')$q$),'decision cannot be repeated');
select pg_temp.expect((public.propose_manual_interaction('Brand new test company','email',now(),'New company','',array['founder@brandnew.example'])->>'status')='review','new name requires review');
select public.resolve_manual_interaction((select id from public.review_items where payload->>'subject'='New company'),'create',null,null,'brandnew.example');
select pg_temp.expect((select count(*) from public.companies where name='Brand new test company')=1,'new company only after confirmation');
select pg_temp.expect((public.propose_manual_interaction('','email',now(),'Ignore case','',array['no@unknown.example'])->>'status')='review','unknown domain creates review');
select public.resolve_manual_interaction((select id from public.review_items where payload->>'subject'='Ignore case'),'ignore');
select pg_temp.expect((select count(*) from public.interactions where subject='Ignore case')=0,'ignore does not create interaction');
reset role;
rollback;
