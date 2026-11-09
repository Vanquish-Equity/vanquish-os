-- Disposable Postgres only. Every fixture and write is rolled back.
begin;

create function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'COMPANY DIGEST FAILED: %', label; end if; end $$;
create function pg_temp.state(sql text) returns text language plpgsql as $$
begin execute sql; return 'none'; exception when others then return sqlstate; end $$;
create function pg_temp.who(email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role','authenticated','email',email)::text, true)
$$;

insert into public.app_members(email, display_name) values
  ('p3.scout@synthetic.test', 'Scout'), ('p3.other@synthetic.test', 'Other'), ('p3.admin@synthetic.test', 'Admin');
insert into public.member_permissions(email, permission) values
  ('p3.scout@synthetic.test', 'email_scouting'), ('p3.admin@synthetic.test', 'admin');
select pg_temp.who('p3.other@synthetic.test');

-- Exercise every legacy kind against the replacement CHECKs with real targets.
insert into public.companies(id,name) values ('40000000-0000-0000-0000-000000000001','Legacy fixture');
insert into public.people(id,name) values ('40000000-0000-0000-0000-000000000002','Sample contact');
insert into public.tasks(id,title) values ('40000000-0000-0000-0000-000000000003','Sample task');
insert into public.email_drafts(id,subject,created_by) values
  ('40000000-0000-0000-0000-000000000004','Sample draft','p3.other@synthetic.test');
insert into public.record_comments(id,company_id,author_email,body) values
  ('40000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','p3.other@synthetic.test','Sample comment');
insert into public.contact_reminders(id,person_id,title,due_on,created_by) values
  ('40000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000002','Sample reminder',current_date,'p3.other@synthetic.test');
insert into public.chat_conversations(id,kind,title,created_by) values
  ('40000000-0000-0000-0000-000000000007','group','Sample group','p3.other@synthetic.test');
insert into public.chat_messages(id,conversation_id,author_email,body) values
  ('40000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000007','p3.other@synthetic.test','Sample message');

insert into public.notifications(recipient_email,kind,conversation_id,message_id,dedupe_key)
select 'p3.other@synthetic.test',kind,'40000000-0000-0000-0000-000000000007','40000000-0000-0000-0000-000000000008','p3:' || kind
from unnest(array['chat_direct','chat_group','chat_mention']) kind;
insert into public.notifications(recipient_email,kind,task_id,dedupe_key)
values ('p3.other@synthetic.test','task_assigned','40000000-0000-0000-0000-000000000003','p3:task_assigned');
insert into public.notifications(recipient_email,kind,draft_id,dedupe_key)
values ('p3.other@synthetic.test','draft_assigned','40000000-0000-0000-0000-000000000004','p3:draft_assigned');
insert into public.notifications(recipient_email,kind,comment_id,dedupe_key)
select 'p3.other@synthetic.test',kind,'40000000-0000-0000-0000-000000000005','p3:' || kind
from unnest(array['comment_mention','comment_reply']) kind;
insert into public.notifications(recipient_email,kind,person_id,contact_reminder_id,dedupe_key)
values
  ('p3.other@synthetic.test','contact_reminder','40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000006','p3:contact_reminder'),
  ('p3.other@synthetic.test','contact_note_tag','40000000-0000-0000-0000-000000000002',null,'p3:contact_note_tag');
select pg_temp.expect((select count(*)=9 from public.notifications where dedupe_key like 'p3:%' and company_suggestions_count is null),'all nine old kinds still insert');
select pg_temp.expect(pg_temp.state($q$insert into public.notifications(recipient_email,kind,dedupe_key) values ('p3.other@synthetic.test','company_suggestions_digest','bad-count')$q$)='23514','digest requires a positive count');
select pg_temp.expect(pg_temp.state($q$insert into public.notifications(recipient_email,kind,dedupe_key,company_suggestions_count,task_id) values ('p3.other@synthetic.test','company_suggestions_digest','bad-target',1,'40000000-0000-0000-0000-000000000003')$q$)='23514','digest cannot carry a target');
select pg_temp.expect(pg_temp.state($q$insert into public.notifications(recipient_email,kind,dedupe_key,company_suggestions_count,task_id) values ('p3.other@synthetic.test','task_assigned','bad-old-count',1,'40000000-0000-0000-0000-000000000003')$q$)='23514','legacy kinds cannot carry a digest count');

insert into public.notifications(recipient_email,kind,dedupe_key,company_suggestions_count,created_at)
values ('p3.scout@synthetic.test','company_suggestions_digest',
        'company_suggestions_digest:' || to_char((statement_timestamp() at time zone 'UTC')::date - 1, 'YYYY-MM-DD'), 4, now() - interval '1 day');

set local role authenticated;
select pg_temp.who('p3.scout@synthetic.test');
insert into public.company_suggestions(id,member_email,domain,suggested_name,first_seen_at,last_seen_at,created_at)
values
  ('40000000-0000-0000-0000-000000000009','p3.scout@synthetic.test','alpha.synthetic.test','Sample Alpha',now(),now(),now() - interval '1 day'),
  ('40000000-0000-0000-0000-000000000010','p3.scout@synthetic.test','beta.synthetic.test','Sample Beta',now(),now(),now());
select pg_temp.expect((select count(*)=2 and sum(company_suggestions_count)=6 from public.notifications where kind='company_suggestions_digest'),'one new digest plus the unchanged previous day');
select pg_temp.expect((select company_suggestions_count=2 and actor_email is null and task_id is null
  from public.notifications where dedupe_key='company_suggestions_digest:' || to_char((statement_timestamp() at time zone 'UTC')::date, 'YYYY-MM-DD')),'both inserts use database UTC day and do not store mailbox details');
insert into public.company_suggestions(member_email,domain,suggested_name,first_seen_at,last_seen_at)
values ('p3.scout@synthetic.test','beta.synthetic.test','Duplicate',now(),now()) on conflict (member_email,domain) do nothing;
update public.company_suggestions set thread_count=2 where domain='alpha.synthetic.test';
update public.company_suggestions set status='dismissed' where domain='beta.synthetic.test';
select public.accept_company_suggestion('40000000-0000-0000-0000-000000000009','Sample approved company');
select pg_temp.expect((select count(*)=2 and sum(company_suggestions_count)=6 from public.notifications where kind='company_suggestions_digest'),'retries, refreshes, approvals and dismissals do not add to the digest');
select pg_temp.expect(pg_temp.state($q$insert into public.notifications(recipient_email,kind,dedupe_key,company_suggestions_count) values ('p3.scout@synthetic.test','company_suggestions_digest','forged',99)$q$)='42501','members cannot forge notifications');
select pg_temp.expect(pg_temp.state($q$update public.notifications set company_suggestions_count=99 where kind='company_suggestions_digest'$q$)='42501','members cannot change counts');
update public.notifications set read_at=now() where kind='company_suggestions_digest';
select pg_temp.expect((select count(*)=2 from public.notifications where kind='company_suggestions_digest' and read_at is not null),'owner can still mark digest read');
insert into public.company_suggestions(member_email,domain,suggested_name,first_seen_at,last_seen_at)
values ('p3.scout@synthetic.test','gamma.synthetic.test','Sample Gamma',now(),now());
select pg_temp.expect((select count(*)=2 and sum(company_suggestions_count)=7
  and count(*) filter (where read_at is null and company_suggestions_count=3)=1
  and count(*) filter (where read_at is not null and company_suggestions_count=4)=1
  from public.notifications where kind='company_suggestions_digest'),
  'new suggestion increments and reopens only the current UTC digest');
select pg_temp.expect(pg_temp.state($q$insert into public.company_suggestions(member_email,domain,suggested_name,first_seen_at,last_seen_at) values ('p3.other@synthetic.test','forged.synthetic.test','Forged',now(),now())$q$)='42501','cannot insert another member’s suggestion');
select pg_temp.who('p3.other@synthetic.test');
select pg_temp.expect((select count(*)=0 from public.notifications where kind='company_suggestions_digest'),'other member cannot see digest');
select pg_temp.expect(pg_temp.state($q$insert into public.company_suggestions(member_email,domain,suggested_name,first_seen_at,last_seen_at) values ('p3.other@synthetic.test','forged.synthetic.test','Forged',now(),now())$q$)='42501','member without permission cannot trigger a digest');
select pg_temp.who('p3.admin@synthetic.test');
select pg_temp.expect((select count(*)=0 from public.notifications where kind='company_suggestions_digest'),'admin cannot see another member’s digest');
reset role;
set local role anon;
select pg_temp.expect(pg_temp.state($q$select * from public.notifications$q$)='42501','anon cannot read notifications');
reset role;

rollback;
