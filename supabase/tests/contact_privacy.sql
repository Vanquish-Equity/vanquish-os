-- Contact notes and reminders: Team / Private / Specific people.
-- Raises on the first failed expectation. Run inside one rolled-back transaction.
begin;

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAILED: %', msg; end if; end $$;
create function pg_temp.cnt(q text) returns integer language plpgsql as $$
declare n integer; begin execute q into n; return n; end $$;
-- SQLSTATE raised by a statement, or 'none'.
create function pg_temp.state(q text) returns text language plpgsql as $$
begin execute q; return 'none'; exception when others then return sqlstate; end $$;
create function pg_temp.who(e text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role','authenticated','email',e)::text, true) $$;

insert into public.app_members(email,display_name,is_active) values
  ('cp.alice@synthetic.test','Alice',true), ('cp.bob@synthetic.test','Bob',true),
  ('cp.carol@synthetic.test','Carol',true), ('cp.admin@synthetic.test','Admin',true),
  ('cp.dave@synthetic.test','Dave',false);
insert into public.member_permissions(email,permission) values ('cp.admin@synthetic.test','admin');
insert into public.app_members(email,display_name)
  select 'cp.m' || n || '@synthetic.test','Many ' || n from generate_series(1,11) n;
insert into public.people(id,name) values
  ('cb110000-0000-0000-0000-000000000001','Privacy contact'),
  ('cb110000-0000-0000-0000-000000000002','Archived privacy contact');
-- A note written before this migration: no visibility column in the insert.
insert into public.contact_notes(person_id,author_email,body)
  values ('cb110000-0000-0000-0000-000000000001','cp.alice@synthetic.test','Legacy note');
insert into auth.users(id,email) values ('cb110000-0000-0000-0000-0000000000f0','cp.machine@synthetic.test');
insert into private.machine_identities(sub,enabled,relationships_only)
  values ('cb110000-0000-0000-0000-0000000000f0',true,true);

select pg_temp.ok((select visibility from public.contact_notes where body='Legacy note')='team','legacy notes default to Team');

set local role authenticated;
select pg_temp.who('cp.alice@synthetic.test');
insert into public.contact_notes(person_id,body,visibility) values
  ('cb110000-0000-0000-0000-000000000001','Team note','team'),
  ('cb110000-0000-0000-0000-000000000001','Team note tagging bob','team'),
  ('cb110000-0000-0000-0000-000000000001','Private note','private'),
  ('cb110000-0000-0000-0000-000000000001','Shared note','shared');
insert into public.contact_notes(person_id,body) values ('cb110000-0000-0000-0000-000000000001','Old client note');
select pg_temp.ok((select visibility from public.contact_notes where body='Old client note')='team','insert without visibility is Team');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_notes(person_id,body,visibility) values ('cb110000-0000-0000-0000-000000000001','x','everyone')$q$)='23514','bad visibility rejected');
insert into public.contact_note_recipients(note_id,member_email)
  select id,'cp.bob@synthetic.test' from public.contact_notes where body in ('Team note tagging bob','Shared note');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_note_recipients select id,'cp.alice@synthetic.test' from public.contact_notes where body='Shared note'$q$)='42501','creator cannot include themselves');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_note_recipients select id,'cp.dave@synthetic.test' from public.contact_notes where body='Shared note'$q$)='42501','inactive member cannot be included');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_note_recipients select id,'cp.nobody@synthetic.test' from public.contact_notes where body='Shared note'$q$)='42501','unknown member cannot be included');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_note_recipients select id,'CP.CAROL@synthetic.test' from public.contact_notes where body='Shared note'$q$)='42501','non-normalized email rejected');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_note_recipients select id,'cp.carol@synthetic.test' from public.contact_notes where body='Private note'$q$)='42501','private notes take no recipients');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_notes')=6,'author sees all own notes plus legacy');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients')=2,'author sees recipients');

select pg_temp.who('cp.bob@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_notes where body='Private note'$q$)=0,'private note hidden from other member');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_notes where body in ('Team note','Legacy note','Team note tagging bob','Shared note')$q$)=4,'team and included shared notes visible to bob');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_note_recipients select id,'cp.carol@synthetic.test' from public.contact_notes where body='Shared note'$q$)='42501','included member cannot add recipients');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients')=2,'included member sees recipients of visible notes');
delete from public.contact_note_recipients;
delete from public.contact_notes;
select pg_temp.who('cp.alice@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_notes')=6,'included member cannot delete notes');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients')=2,'included member cannot remove recipients');

select pg_temp.who('cp.carol@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_notes where body in ('Private note','Shared note')$q$)=0,'private and unshared specific notes hidden');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_notes where body in ('Team note','Team note tagging bob','Legacy note')$q$)=3,'team notes visible');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients')=1,'recipients of a Team note stay visible, shared ones do not');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_notes n join public.contact_note_recipients r on r.note_id=n.id')=1,'join cannot leak shared note');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients r where r.note_id in (select id from public.contact_notes where body=''Shared note'')')=0,'shared recipients hidden');

select pg_temp.who('cp.admin@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_notes where body in ('Private note','Shared note')$q$)=0,'admin cannot see private or shared notes');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients r join public.contact_notes n on n.id=r.note_id where n.body=''Shared note''')=0,'admin cannot see shared recipients');

-- Reminders.
select pg_temp.who('cp.alice@synthetic.test');
insert into public.contact_reminders(person_id,title,due_on,visibility) values
  ('cb110000-0000-0000-0000-000000000001','Team reminder','2026-12-01','team'),
  ('cb110000-0000-0000-0000-000000000001','Team plain reminder','2026-12-02','team'),
  ('cb110000-0000-0000-0000-000000000001','Private reminder','2026-12-03','private'),
  ('cb110000-0000-0000-0000-000000000001','Shared reminder','2026-12-04','shared');
insert into public.contact_reminder_recipients(reminder_id,member_email)
  select id,'cp.bob@synthetic.test' from public.contact_reminders where title in ('Team reminder','Shared reminder');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminder_recipients select id,'cp.carol@synthetic.test' from public.contact_reminders where title='Private reminder'$q$)='42501','private reminders take no recipients');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminder_recipients select id,'cp.dave@synthetic.test' from public.contact_reminders where title='Team reminder'$q$)='42501','inactive member cannot be included in a reminder');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminder_recipients select id,'cp.alice@synthetic.test' from public.contact_reminders where title='Team reminder'$q$)='42501','creator cannot include themselves in a reminder');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminders(person_id,title,due_on,created_by) values ('cb110000-0000-0000-0000-000000000001','Spoof','2026-12-01','cp.bob@synthetic.test')$q$)='42501','created_by cannot be set');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminders(person_id,title,due_on) values ('cb110000-0000-0000-0000-000000000001',' ','2026-12-01')$q$)='23514','blank title rejected');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminders')=4,'creator sees own reminders');
-- At most 10 included members.
insert into public.contact_reminders(person_id,title,due_on,visibility) values ('cb110000-0000-0000-0000-000000000001','Crowd','2026-12-05','team');
insert into public.contact_reminder_recipients select r.id,'cp.m'||n||'@synthetic.test' from public.contact_reminders r, generate_series(1,10) n where r.title='Crowd';
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminder_recipients select id,'cp.m11@synthetic.test' from public.contact_reminders where title='Crowd'$q$)='54000','more than 10 included rejected');
delete from public.contact_reminders where title='Crowd';

select pg_temp.who('cp.bob@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title in ('Team reminder','Team plain reminder','Shared reminder')$q$)=3,'bob sees team and included reminders');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title='Private reminder'$q$)=0,'private reminder hidden from member');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders where title='Private reminder'$q$)='none'
  and pg_temp.cnt($q$select count(*) from public.contact_reminders where completed_at is not null$q$)=0,'cannot complete a hidden reminder');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder('cb110000-0000-0000-0000-00000000ffff')$q$)='42501','unknown reminder not available');
select pg_temp.ok(pg_temp.state($q$update public.contact_reminders set completed_by='cp.bob@synthetic.test', completed_at=now()$q$)='42501','completion columns not directly writable');
select pg_temp.ok(pg_temp.state($q$update public.contact_reminders set created_by='cp.bob@synthetic.test'$q$)='42501','created_by not writable');
update public.contact_reminders set visibility='private', title='Hijacked';
delete from public.contact_reminders;
delete from public.contact_reminder_recipients;
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title='Hijacked'$q$)=0,'included member cannot change visibility or title');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminders')=3,'included member cannot delete');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminder_recipients select id,'cp.carol@synthetic.test' from public.contact_reminders where title='Shared reminder'$q$)='42501','included member cannot add recipients to a reminder');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders where title='Team reminder'$q$)='none','included member completes');

select pg_temp.who('cp.carol@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title in ('Private reminder','Shared reminder')$q$)=0,'carol cannot see private or specific reminders');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title in ('Team reminder','Team plain reminder')$q$)=2,'carol sees team reminders');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminders r join public.contact_reminder_recipients x on x.reminder_id=r.id')=1,'recipient join shows only the Team reminder');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders where title='Team plain reminder'$q$)='42501','team viewer without inclusion cannot complete');
select pg_temp.who('cp.alice@synthetic.test');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders where title='Team reminder'$q$)='55000','double completion by creator refused');
select pg_temp.who('cp.bob@synthetic.test');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders where title='Team reminder'$q$)='55000','double completion by included member refused');

select pg_temp.who('cp.admin@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title in ('Private reminder','Shared reminder')$q$)=0,'admin cannot see private or specific reminders');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminder_recipients x join public.contact_reminders r on r.id=x.reminder_id where r.title=''Shared reminder''')=0,'admin cannot see recipients via join');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from (select id from public.contact_reminders where title='Team plain reminder') s$q$)='42501','admin viewer without inclusion cannot complete');
reset role;
select pg_temp.ok((select count(*) from public.contact_reminders where title='Team plain reminder' and completed_at is not null)=0,'admin did not complete a reminder they are not included in');
select pg_temp.ok((select count(*) from public.contact_reminders where title='Private reminder' and completed_at is not null)=0,'private reminder still open');
-- Direct completion probes by non-participants through the function (visible rows only matter above).
set local role authenticated;
select pg_temp.who('cp.carol@synthetic.test');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder((select id from public.contact_reminders where title='Team plain reminder' limit 1))$q$)='42501','non-participant completion refused');
select pg_temp.who('cp.admin@synthetic.test');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder((select id from public.contact_reminders where title='Team plain reminder' limit 1))$q$)='42501','admin non-participant completion refused');
reset role;
select pg_temp.ok((select completed_by from public.contact_reminders where title='Team reminder')='cp.bob@synthetic.test','completed_by is the caller');
select pg_temp.ok((select completed_at is not null from public.contact_reminders where title='Team reminder'),'completed_at set');
set local role authenticated;

-- Private reminder: creator completes; a reminder only visible to others cannot be probed by id.
select pg_temp.who('cp.alice@synthetic.test');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders where title='Private reminder'$q$)='none','creator completes own private reminder');
select pg_temp.ok((select completed_by from public.contact_reminders where title='Private reminder')='cp.alice@synthetic.test','completed_by alice');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders where title='Private reminder'$q$)='55000','double completion by creator refused');
-- Creator changes visibility to private: the included member loses access.
update public.contact_reminders set visibility='private' where title='Shared reminder';
select pg_temp.who('cp.bob@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title='Shared reminder'$q$)=0,'member loses access when made private');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder((select id from public.contact_reminders where title='Shared reminder'))$q$)='42501','former recipient cannot complete');
select pg_temp.who('cp.alice@synthetic.test');
update public.contact_reminders set visibility='shared' where title='Shared reminder';
delete from public.contact_reminder_recipients where member_email='cp.bob@synthetic.test'
  and reminder_id in (select id from public.contact_reminders where title='Shared reminder');
select pg_temp.who('cp.bob@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.contact_reminders where title='Shared reminder'$q$)=0,'removed recipient loses the item');

-- Home list: creator or included, not done, soonest first, own view only.
select pg_temp.who('cp.alice@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.my_contact_reminders()')=2,'creator list: open own reminders (Team plain, Shared) only');
select pg_temp.ok((select due_on from public.my_contact_reminders() limit 1)='2026-12-02','soonest first');
select pg_temp.who('cp.carol@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.my_contact_reminders()')=0,'team viewer not included has none');
select pg_temp.who('cp.admin@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.my_contact_reminders()')=0,'admin has none');
select pg_temp.who('cp.outsider@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.my_contact_reminders()')=0,'non-member has none');
select pg_temp.ok(pg_temp.state('select count(*) from public.my_contact_reminders()')='none','non-member call returns nothing');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.state('select count(*) from public.my_contact_reminders()')='42501','anon cannot call my_contact_reminders');
reset role;
set local role authenticated;
select pg_temp.who('cp.bob@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.my_contact_reminders()')=0,'bob: Team reminder is done, Shared one removed');

-- Notifications.
reset role;
select pg_temp.ok((select count(*) from public.notifications where kind='contact_reminder' and recipient_email='cp.bob@synthetic.test')=2,'bob notified once per reminder he was included in');
select pg_temp.ok((select count(*) from public.notifications where kind='contact_reminder' and recipient_email<>'cp.bob@synthetic.test')=0,'nobody else notified of reminders (team viewers, creator)');
select pg_temp.ok((select count(*) from public.notifications where kind='contact_note_tag')=2,'two note tags notified');
select pg_temp.ok((select count(*) from public.notifications where kind='contact_note_tag' and recipient_email='cp.bob@synthetic.test' and actor_email='cp.alice@synthetic.test')=2,'bob notified of note tags by alice');
select pg_temp.ok((select count(*) from public.notifications where recipient_email='cp.alice@synthetic.test' and kind in ('contact_reminder','contact_note_tag'))=0,'creator not self-notified');
select pg_temp.ok((select count(*) from public.notifications where recipient_email='cp.carol@synthetic.test' and kind in ('contact_reminder','contact_note_tag'))=0,'team items notify nobody unless included');
select pg_temp.ok((select count(*) from public.notifications n where n.kind='contact_reminder' and n.person_id is not null and n.contact_reminder_id is not null)=2,'reminder notifications carry person and reminder');

-- Included member is told with the person link; reading is limited to own rows.
set local role authenticated;
select pg_temp.who('cp.bob@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.notifications where kind in ('contact_reminder','contact_note_tag')$q$)=4,'bob reads his own notifications');
select pg_temp.who('cp.carol@synthetic.test');
select pg_temp.ok(pg_temp.cnt($q$select count(*) from public.notifications where kind in ('contact_reminder','contact_note_tag')$q$)=0,'carol reads none');
select pg_temp.ok(pg_temp.state($q$insert into public.notifications(recipient_email,kind,person_id,dedupe_key) values ('cp.carol@synthetic.test','contact_note_tag','cb110000-0000-0000-0000-000000000001','forged')$q$)='42501','members cannot forge notifications');

-- Non-member, machine identity and anon.
select pg_temp.who('cp.outsider@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_notes')=0,'non-member sees no notes');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminders')=0,'non-member sees no reminders');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminder_recipients')=0,'non-member sees no reminder recipients');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients')=0,'non-member sees no note recipients');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminders(person_id,title,due_on) values ('cb110000-0000-0000-0000-000000000001','Outsider','2026-12-01')$q$)='42501','non-member cannot add reminders');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder(id) from public.contact_reminders$q$)='none','non-member completion touches nothing');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder('cb110000-0000-0000-0000-00000000ffff')$q$)='42501','non-member completion refused');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"cb110000-0000-0000-0000-0000000000f0","email":"cp.machine@synthetic.test"}',true);
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_notes')=0,'machine identity sees no notes');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminders')=0,'machine identity sees no reminders');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminder_recipients')=0,'machine identity sees no recipients');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder('cb110000-0000-0000-0000-00000000ffff')$q$)='42501','machine identity completion refused');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.state('select count(*) from public.contact_reminders')='42501','anon cannot read reminders');
select pg_temp.ok(pg_temp.state('select count(*) from public.contact_reminder_recipients')='42501','anon cannot read reminder recipients');
select pg_temp.ok(pg_temp.state('select count(*) from public.contact_note_recipients')='42501','anon cannot read note recipients');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder('cb110000-0000-0000-0000-00000000ffff')$q$)='42501','anon cannot execute completion');
reset role;

-- Archived contact hides everything and refuses new items.
insert into public.contact_notes(person_id,author_email,body,visibility)
  values ('cb110000-0000-0000-0000-000000000002','cp.alice@synthetic.test','Archived team note','team');
insert into public.contact_reminders(person_id,title,due_on,created_by)
  values ('cb110000-0000-0000-0000-000000000002','Archived reminder','2026-12-01','cp.alice@synthetic.test');
update public.people set archived_at=now() where id in ('cb110000-0000-0000-0000-000000000001','cb110000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.who('cp.alice@synthetic.test');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_notes')=0,'archived contact hides notes');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminders')=0,'archived contact hides reminders');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_reminder_recipients')=0,'archived contact hides reminder recipients');
select pg_temp.ok(pg_temp.cnt('select count(*) from public.contact_note_recipients')=0,'archived contact hides note recipients');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_reminders(person_id,title,due_on) values ('cb110000-0000-0000-0000-000000000002','Late','2026-12-01')$q$)='42501','no reminder for archived contact');
select pg_temp.ok(pg_temp.state($q$insert into public.contact_notes(person_id,body) values ('cb110000-0000-0000-0000-000000000002','Late')$q$)='42501','no note for archived contact');
select pg_temp.ok(pg_temp.state($q$select public.complete_contact_reminder((select id from public.contact_reminders where title='Archived reminder'))$q$)='42501','archived contact reminder cannot be completed');
reset role;
select pg_temp.ok((select completed_at is null from public.contact_reminders where title='Archived reminder'),'archived reminder stayed open');

-- Old reminder tasks and their policy are untouched.
select pg_temp.ok(exists (select 1 from pg_policies where tablename='tasks' and policyname='tasks_contact_insert'),'tasks policy untouched');

rollback;
