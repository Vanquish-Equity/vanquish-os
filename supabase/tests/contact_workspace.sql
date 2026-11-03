begin;
insert into public.app_members(email,display_name) values
  ('contact.owner@synthetic.test','Synthetic owner'), ('contact.reader@synthetic.test','Synthetic reader');
insert into public.member_permissions(email,permission) values ('contact.owner@synthetic.test','documents');
insert into public.people(id,name) values ('dc110000-0000-0000-0000-000000000001','Synthetic contact');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"contact.owner@synthetic.test"}',true);
insert into public.contact_notes(person_id,body) values ('dc110000-0000-0000-0000-000000000001','Synthetic note');
insert into public.tasks(person_id,title,due_at,assignee_email) values
 ('dc110000-0000-0000-0000-000000000001','Synthetic follow-up',current_date,'contact.owner@synthetic.test');
insert into storage.objects(bucket_id,name) values
 ('contact-files','dc110000-0000-0000-0000-000000000001/dc110000-0000-0000-0000-000000000002_example.txt');
do $$begin
  if not exists (select 1 from storage.objects where bucket_id='contact-files') then raise exception 'Documents member cannot see attachment'; end if;
  if not exists (select 1 from public.tasks where person_id='dc110000-0000-0000-0000-000000000001')
    then raise exception 'Contact reminder did not appear in tasks'; end if;
end$$;

select set_config('request.jwt.claims','{"role":"authenticated","email":"contact.reader@synthetic.test"}',true);
do $$begin
  if not exists(select 1 from public.contact_notes where body='Synthetic note') then raise exception 'Shared note unavailable'; end if;
  delete from public.contact_notes where body='Synthetic note';
  if found then raise exception 'A different member removed the note'; end if;
  if exists (select 1 from storage.objects where bucket_id='contact-files') then raise exception 'Member without Documents saw an attachment'; end if;
  begin
    insert into storage.objects(bucket_id,name) values
      ('contact-files','dc110000-0000-0000-0000-000000000001/dc110000-0000-0000-0000-000000000003_example.txt');
    raise exception 'Member without Documents uploaded an attachment';
  exception when insufficient_privilege then null; end;
end$$;

select set_config('request.jwt.claims','{"role":"authenticated","email":"contact.outsider@synthetic.test"}',true);
do $$begin
  if exists(select 1 from public.contact_notes where body='Synthetic note') then raise exception 'Non-member saw a note'; end if;
end$$;
reset role;
update public.people set archived_at=now() where id='dc110000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"contact.owner@synthetic.test"}',true);
do $$begin
  if exists(select 1 from public.contact_notes where body='Synthetic note') or exists(select 1 from storage.objects where bucket_id='contact-files')
    then raise exception 'Archived contact still exposes notes or files'; end if;
  begin
    insert into public.tasks(person_id,title) values ('dc110000-0000-0000-0000-000000000001','Synthetic archived follow-up');
    raise exception 'Reminder was created for an archived contact';
  exception when insufficient_privilege then null; end;
end$$;
rollback;
