-- Disposable ONLY. Protect an uncertain synthetic result even through rollback.
insert into public.app_members(email) values('calendar.rollback@synthetic.test');
insert into private.calendar_mutation_reviews(id,owner_email,operation,revision,connection_revision,resource_hash,state) values('f6100000-0000-0000-0000-000000000001','calendar.rollback@synthetic.test','save',repeat('a',64),'synthetic-epoch',repeat('a',64),'uncertain');
update private.calendar_completion_configuration set enabled=true;
\set ON_ERROR_STOP off
\ir ../phase-sql/phase-5b-rollback.sql
\set ON_ERROR_STOP on
rollback;
do $$begin
 if (select enabled from private.calendar_completion_configuration) then raise exception 'Pause must survive refused schema rollback';end if;
 if not exists(select 1 from private.calendar_mutation_reviews where id='f6100000-0000-0000-0000-000000000001' and state='uncertain') then raise exception 'Protected record deleted';end if;
end$$;
-- DELETE: only this disposable synthetic test fixture, not a rollback data repair.
delete from private.calendar_mutation_reviews where id='f6100000-0000-0000-0000-000000000001';
delete from public.app_members where email='calendar.rollback@synthetic.test';
