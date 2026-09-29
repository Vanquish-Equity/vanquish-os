begin;
create or replace function pg_temp.act(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims',json_build_object('role','authenticated','email',p_email)::text,true); execute 'set local role authenticated'; end $$;
create or replace function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'BOARD IMPORT TEST FAILED: %',label; end if; raise notice 'ok - %',label; end $$;
create or replace function pg_temp.denied(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.act(text),pg_temp.expect(boolean,text),pg_temp.denied(text) to authenticated;
create temporary table import_test(lp_board uuid,lp_column uuid,crm_board uuid,crm_column uuid,person uuid,company uuid) on commit drop;
grant all on import_test to authenticated;
insert into import_test default values;
select pg_temp.act('marios@vanquishequity.com');
update import_test set lp_board=public.lp_ensure_board();
update import_test set lp_column=(select id from public.lp_board_columns where board_id=(select lp_board from import_test) order by sort_order limit 1);
update import_test set crm_board=public.crm_create_flexible_board('Import test',false);
insert into public.crm_board_columns(board_id,name,sort_order) select crm_board,'To do',0 from import_test;
update import_test set crm_column=(select id from public.crm_board_columns where board_id=(select crm_board from import_test) order by sort_order limit 1);
insert into public.companies(name) values ('Import Test Company');
update import_test set company=(select id from public.companies where name='Import Test Company' limit 1);
insert into public.people(name,is_potential_lp) values ('Import Test Person',false);
update import_test set person=(select id from public.people where name='Import Test Person' limit 1);
select pg_temp.expect((select public.import_directory_to_board(lp_board,lp_column,'person',array[person],true)=1 from import_test),'person imported to private LP board');
select pg_temp.expect((select public.import_directory_to_board(lp_board,lp_column,'person',array[person],true)=0 from import_test),'duplicate LP import skipped');
select pg_temp.expect((select public.import_directory_to_board(crm_board,crm_column,'company',array[company],false)=1 from import_test),'company imported to general board');
select pg_temp.expect((select count(*)=1 from public.crm_board_items where source_company_id=(select company from import_test)),'source linked on general board');
reset role;
select pg_temp.act('pbp@vanquishequity.com');
select pg_temp.expect(pg_temp.denied($q$select public.import_directory_to_board((select lp_board from import_test),(select lp_column from import_test),'company',array[(select company from import_test)],true)$q$),'other member cannot import to private LP board');
reset role;
rollback;
