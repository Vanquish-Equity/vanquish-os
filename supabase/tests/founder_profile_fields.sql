-- Disposable PostgreSQL only. All fixtures roll back.
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FOUNDER PROFILE FAILED: %',label;end if;end$$;
create function pg_temp.state(sql text) returns text language plpgsql as $$
begin execute sql;return 'none';exception when others then return sqlstate;end$$;
create function pg_temp.who(email text,sub text default null) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','email',email,'sub',sub)::text,true)
$$;

insert into public.app_members(email,display_name,is_active) values
 ('p8.member@synthetic.test','Profile Member',true),
 ('p8.disabled@synthetic.test','Disabled Member',false);
insert into public.people(id,name) values
 ('80000000-0000-4000-8000-000000000001','Example Founder');
select pg_temp.expect((select city is null and country is null and origin is null from public.people where id='80000000-0000-4000-8000-000000000001'),'new optional fields stay null without a fill');

set local role authenticated;
select pg_temp.who('p8.member@synthetic.test');
update public.people set title='Example founder',city='Example City',country='Example Country',origin='Example Origin'
where id='80000000-0000-4000-8000-000000000001';
select pg_temp.expect((select title='Example founder' and city='Example City' and country='Example Country' and origin='Example Origin' from public.people where id='80000000-0000-4000-8000-000000000001'),'existing member edits old and new columns');
select pg_temp.expect(pg_temp.state($q$update public.people set city='   ' where id='80000000-0000-4000-8000-000000000001'$q$)='23514','space-only city rejected');
select pg_temp.expect(pg_temp.state($q$update public.people set country=E'\t\n' where id='80000000-0000-4000-8000-000000000001'$q$)='23514','whitespace-only country rejected');
select pg_temp.expect(pg_temp.state($q$update public.people set origin='' where id='80000000-0000-4000-8000-000000000001'$q$)='23514','empty origin rejected');
select pg_temp.expect(pg_temp.state($q$update public.people set city=repeat('x',121) where id='80000000-0000-4000-8000-000000000001'$q$)='23514','city length bounded');
select pg_temp.expect(pg_temp.state($q$update public.people set country=repeat('x',121) where id='80000000-0000-4000-8000-000000000001'$q$)='23514','country length bounded');
select pg_temp.expect(pg_temp.state($q$update public.people set origin=repeat('x',161) where id='80000000-0000-4000-8000-000000000001'$q$)='23514','origin length bounded');
update public.people set city=null,country=null,origin=null where id='80000000-0000-4000-8000-000000000001';
select pg_temp.expect((select city is null and country is null and origin is null from public.people where id='80000000-0000-4000-8000-000000000001'),'member can clear optional fields');

select pg_temp.who('p8.disabled@synthetic.test');
select pg_temp.expect((select count(*)=0 from public.people where id='80000000-0000-4000-8000-000000000001'),'disabled member cannot read People');
select pg_temp.expect(pg_temp.state($q$insert into public.people(name,city) values('Disabled attempt','Example City')$q$)='42501','disabled member cannot write');
select pg_temp.who('p8.outside@synthetic.test');
select pg_temp.expect((select count(*)=0 from public.people),'nonmember cannot read');
select pg_temp.expect(pg_temp.state($q$insert into public.people(name,city) values('Outside attempt','Example City')$q$)='42501','nonmember cannot write');

reset role;
-- Mutation proof: the same rejected-value assertion must fail with each new
-- CHECK removed. Each inner exception rolls the altered DDL and row back.
do $$
declare field text; detected boolean; expected_message text;
begin
  foreach field in array array['city','country','origin'] loop
    detected:=false;
    expected_message:='FOUNDER PROFILE FAILED: mutation '||field;
    begin
      execute format('alter table public.people drop constraint %I','people_'||field||'_content_check');
      perform pg_temp.expect(pg_temp.state(format(
        'update public.people set %I=%L where id=%L',field,'   ','80000000-0000-4000-8000-000000000001'))='23514',
        'mutation '||field);
    exception when raise_exception then
      if sqlerrm<>expected_message then raise;end if;
      detected:=true;
    end;
    if not detected then raise exception 'Mutation was not detected for %',field;end if;
    if not exists(select 1 from pg_constraint where conrelid='public.people'::regclass and conname='people_'||field||'_content_check') then
      raise exception 'Mutation did not restore constraint for %',field;
    end if;
    raise notice 'P8 mutation detected: removed % CHECK makes rejection assertion fail; restored',field;
  end loop;
end$$;

-- An Auth service user is deliberately not an app member.
insert into auth.users(id,email) values('80000000-0000-4000-8000-000000000002','p8.machine@synthetic.test');
insert into private.machine_identities(sub,enabled,relationships_only)
values('80000000-0000-4000-8000-000000000002',true,true);
set local role authenticated;
select pg_temp.who('p8.machine@synthetic.test','80000000-0000-4000-8000-000000000002');
select pg_temp.expect((select count(*)=0 from public.people),'machine cannot read People');
select pg_temp.expect(pg_temp.state($q$insert into public.people(name,city) values('Machine attempt','Example City')$q$)='42501','machine cannot insert People');
with changed as (update public.people set city='Machine override' where id='80000000-0000-4000-8000-000000000001' returning id)
select pg_temp.expect((select count(*)=0 from changed),'machine cannot update People');
reset role;
set local role anon;
select pg_temp.expect(pg_temp.state($q$select city,country,origin from public.people$q$)='42501','anon cannot read');
select pg_temp.expect(pg_temp.state($q$insert into public.people(name,city) values('Anon attempt','Example City')$q$)='42501','anon cannot write');
reset role;
rollback;
