-- Disposable ONLY. Protect an uncertain synthetic result even through rollback.
insert into public.app_members(email) values('mail.rollback@synthetic.test');
insert into private.mail_mutation_reviews(id,owner_email,operation,revision,connection_revision,draft_id,state) values('f5100000-0000-0000-0000-000000000001','mail.rollback@synthetic.test','send',repeat('a',64),'synthetic-epoch','synthetic-protected-draft','uncertain');
update private.mail_completion_configuration set enabled=true;
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-5a-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin
 if (select enabled from private.mail_completion_configuration) then raise exception 'Pause must survive refused schema rollback';end if;
 if not exists(select 1 from private.mail_mutation_reviews where id='f5100000-0000-0000-0000-000000000001' and state='uncertain') then raise exception 'Protected record deleted';end if;
end$$;
-- DELETE: only this disposable synthetic test fixture, not a rollback data repair.
delete from private.mail_mutation_reviews where id='f5100000-0000-0000-0000-000000000001';
delete from public.app_members where email='mail.rollback@synthetic.test';
