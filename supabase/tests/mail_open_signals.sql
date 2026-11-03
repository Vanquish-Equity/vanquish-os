begin;
insert into public.app_members(email,display_name) values
 ('open.sender@synthetic.test','Synthetic sender'),('open.other@synthetic.test','Synthetic other');
insert into public.people(id,name) values ('face0000-0000-0000-0000-000000000001','Synthetic recipient');
insert into public.person_emails(person_id,email) values ('face0000-0000-0000-0000-000000000001','open.recipient@synthetic.test');
insert into private.mail_mutation_reviews(id,owner_email,operation,revision,connection_revision,draft_id,state)
 values ('face0000-0000-0000-0000-000000000002','open.sender@synthetic.test','send',repeat('a',64),'test','draft','claimed');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"open.sender@synthetic.test"}',true);
select public.register_mail_open_tracking('face0000-0000-0000-0000-000000000002',repeat('a',64),'open.recipient@synthetic.test',repeat('b',64));
select public.record_mail_open_signal(repeat('b',64),false);
reset role;
do $$begin
 if exists(select 1 from private.mail_open_signals where review_id='face0000-0000-0000-0000-000000000002') then raise exception 'Unconfirmed send recorded';end if;
end$$;
update private.mail_mutation_reviews set state='completed',dispatch_started_at=now() where id='face0000-0000-0000-0000-000000000002';

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select public.record_mail_open_signal(repeat('c',64),false);
select public.record_mail_open_signal(repeat('b',64),false);
select public.record_mail_open_signal(repeat('b',64),false);
select public.record_mail_open_signal(repeat('b',64),true);
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"open.other@synthetic.test"}',true);
do $$begin
 if exists(select 1 from public.person_mail_open_signals('face0000-0000-0000-0000-000000000001')) then raise exception 'Other member can read signals';end if;
end$$;
select set_config('request.jwt.claims','{"role":"authenticated","email":"open.sender@synthetic.test"}',true);
do $$begin
 if (select count(*) from public.person_mail_open_signals('face0000-0000-0000-0000-000000000001')) <> 2 then raise exception 'Signal deduplication failed';end if;
end$$;
rollback;
