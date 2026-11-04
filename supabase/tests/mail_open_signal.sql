begin;
create function pg_temp.assert_signal(ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'Mail open signal assertion failed'; end if; end $$;
insert into public.app_members(email,is_active) values('signal.one@synthetic.test',true),('signal.two@synthetic.test',true);
insert into public.member_permissions(email,permission) values('signal.one@synthetic.test','mail_completion'),('signal.two@synthetic.test','mail_completion');
insert into public.google_mailbox_connections(email,granted_scopes,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)
 select email,array['https://www.googleapis.com/auth/gmail.modify'],'synthetic-cipher','synthetic-iv','synthetic-tag'
 from public.app_members where email in ('signal.one@synthetic.test','signal.two@synthetic.test');
update private.mail_completion_configuration set enabled=true;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"signal.one@synthetic.test"}',true);
select public.create_mail_review('f5100000-0000-0000-0000-000000000001','send',repeat('a',64),
 public.mail_completion_context()->>'connectionRevision','synthetic-draft');
select public.advance_mail_review('f5100000-0000-0000-0000-000000000001','claim',repeat('a',64));
select public.register_mail_open_signal('f5100000-0000-0000-0000-000000000001',repeat('a',64),repeat('b',64));
set local role anon;
select public.record_mail_open_signal(repeat('b',64));
set local role authenticated;
select public.advance_mail_review('f5100000-0000-0000-0000-000000000001','dispatch',repeat('a',64));
select public.advance_mail_review('f5100000-0000-0000-0000-000000000001','completed');
select pg_temp.assert_signal((select count(*)=1 from public.my_mail_open_signals() where first_seen is null));
set local role anon;
select public.record_mail_open_signal(repeat('c',64));
select public.record_mail_open_signal(repeat('b',64));
set local role authenticated;
select pg_temp.assert_signal((select count(*)=1 from public.my_mail_open_signals() where first_seen is not null));
select set_config('request.jwt.claims','{"role":"authenticated","email":"signal.two@synthetic.test"}',true);
select pg_temp.assert_signal((select count(*)=0 from public.my_mail_open_signals()));
rollback;
