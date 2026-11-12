-- P8 regression/permission/mutation suite; disposable native PostgreSQL only.
-- All fixtures and temporary mutations roll back, including function changes.
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'FOUNDER MERGE FAILED: %',label;end if;end$$;
create function pg_temp.state(sql text) returns text language plpgsql as $$
begin execute sql;return 'none';exception when others then return sqlstate;end$$;
create function pg_temp.who(email text,sub text default null) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','email',email,'sub',sub)::text,true)
$$;

select pg_temp.expect(has_function_privilege('authenticated','public.merge_people(uuid,uuid)','EXECUTE'),'authenticated retains merge execution');
select pg_temp.expect(not has_function_privilege('anon','public.merge_people(uuid,uuid)','EXECUTE'),'anon still has no merge execution');
select pg_temp.expect(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='public.merge_people(uuid,uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC retains no merge execution');
select pg_temp.expect((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.merge_people(uuid,uuid)'::regprocedure),'merge retains baseline definer and empty search path');

insert into public.app_members(email,display_name,is_active) values
 ('p8.merge@synthetic.test','Synthetic Merge Member',true),
 ('p8.merge.disabled@synthetic.test','Synthetic Disabled Member',false);
insert into public.companies(id,name) values('81000000-0000-4000-8000-000000000001','Synthetic Merge Company');
insert into public.people(id,name,title,city,country,origin,linkedin_url,primary_organization_id,is_potential_lp) values
 ('81000000-0000-4000-8000-000000000010','Synthetic Empty Keep',null,null,null,null,null,null,false),
 ('81000000-0000-4000-8000-000000000011','Synthetic Source','Example Role','Example City','Example Country','Example Origin','https://synthetic.test/profile','81000000-0000-4000-8000-000000000001',true),
 ('81000000-0000-4000-8000-000000000020','Synthetic Filled Keep','Kept Role','Kept City','Kept Country','Kept Origin',null,null,false),
 ('81000000-0000-4000-8000-000000000021','Synthetic Other Source','Other Role','Other City','Other Country','Other Origin',null,null,false);
insert into public.person_emails(person_id,email,is_primary) values
 ('81000000-0000-4000-8000-000000000010','merge.keep@synthetic.test',true),
 ('81000000-0000-4000-8000-000000000011','merge.drop@synthetic.test',true);
insert into public.person_groups(id,name,kind) values('81000000-0000-4000-8000-000000000030','Synthetic Merge Group','custom');
insert into public.person_group_members(group_id,person_id) values
 ('81000000-0000-4000-8000-000000000030','81000000-0000-4000-8000-000000000010'),
 ('81000000-0000-4000-8000-000000000030','81000000-0000-4000-8000-000000000011');

select pg_temp.who('p8.merge@synthetic.test');

-- Mutation proof for every new merge expression: both inheritance and keeping
-- an existing value must fail when their respective protection is removed.
do $proof$
declare field text; definition text; mutant text; mode text; label text; detected boolean;
begin
 select pg_get_functiondef('public.merge_people(uuid,uuid)'::regprocedure) into definition;
 foreach field in array array['city','country','origin'] loop
  foreach mode in array array['inherit','preserve'] loop
   label:='mutation '||mode||' '||field;detected:=false;
   if mode='inherit' then
    mutant:=replace(definition,field||' = coalesce(nullif(btrim(v_keep.'||field||'), ''''), v_drop.'||field||'),','');
   else
    mutant:=replace(definition,field||' = coalesce(nullif(btrim(v_keep.'||field||'), ''''), v_drop.'||field||'),',field||' = v_drop.'||field||',');
   end if;
   if mutant=definition then raise exception 'Mutation did not change definition: %',label;end if;
   begin
    execute mutant;
    if mode='inherit' then
     perform public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000011');
     execute format('select pg_temp.expect(%I=%L,%L) from public.people where id=%L',field,'Example '||initcap(field),label,'81000000-0000-4000-8000-000000000010');
    else
     perform public.merge_people('81000000-0000-4000-8000-000000000020','81000000-0000-4000-8000-000000000021');
     execute format('select pg_temp.expect(%I=%L,%L) from public.people where id=%L',field,'Kept '||initcap(field),label,'81000000-0000-4000-8000-000000000020');
    end if;
   exception when raise_exception then
    if sqlerrm<>'FOUNDER MERGE FAILED: '||label then raise;end if;
    detected:=true;
   end;
   if not detected then raise exception 'Mutation survived: %',label;end if;
   if pg_get_functiondef('public.merge_people(uuid,uuid)'::regprocedure)<>definition then raise exception 'Mutation not restored: %',label;end if;
   raise notice 'P8 mutation detected and restored: %',label;
  end loop;
 end loop;
end $proof$;

set local role authenticated;
select pg_temp.who('p8.merge@synthetic.test');
select public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000011');
select pg_temp.expect((select city='Example City' and country='Example Country' and origin='Example Origin' from public.people where id='81000000-0000-4000-8000-000000000010'),'empty kept contact inherits all founder fields');
select pg_temp.expect((select title='Example Role' and linkedin_url='https://synthetic.test/profile' and primary_organization_id='81000000-0000-4000-8000-000000000001' and is_potential_lp from public.people where id='81000000-0000-4000-8000-000000000010'),'old blank fields and LP behavior are preserved');
select pg_temp.expect((select count(*)=2 and count(*) filter(where is_primary)=1 from public.person_emails where person_id='81000000-0000-4000-8000-000000000010'),'email merge retains exactly one primary');
select pg_temp.expect((select count(*)=1 from public.person_group_members where group_id='81000000-0000-4000-8000-000000000030'),'group duplicates collapse');
select public.merge_people('81000000-0000-4000-8000-000000000020','81000000-0000-4000-8000-000000000021');
select pg_temp.expect((select title='Kept Role' and city='Kept City' and country='Kept Country' and origin='Kept Origin' from public.people where id='81000000-0000-4000-8000-000000000020'),'kept nonblank values are not overwritten');
select pg_temp.expect(pg_temp.state($q$select public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000010')$q$)='22023','self merge rejected');
select pg_temp.expect(pg_temp.state($q$select public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000011')$q$)='22023','archived drop cannot merge again');
reset role;
select pg_temp.expect((select archived_at is not null and city='Example City' from public.people where id='81000000-0000-4000-8000-000000000011'),'source is archived with data retained, never deleted');

-- Every new field rejects whitespace mixed only with the documented invisible
-- format characters, using the CHECK violation SQLSTATE rather than any error.
do $invisible$
declare field text; marker text;
begin
 foreach field in array array['city','country','origin'] loop
  foreach marker in array array[U&'\200B',U&'\200C\200D',U&'\2060',U&'\FEFF'] loop
   perform pg_temp.expect(pg_temp.state(format('update public.people set %I=%L where id=%L',field,' '||marker||' ','81000000-0000-4000-8000-000000000020'))='23514','invisible-only '||field);
  end loop;
 end loop;
end $invisible$;

insert into auth.users(id,email) values('81000000-0000-4000-8000-000000000040','p8.merge.machine@synthetic.test');
insert into private.machine_identities(sub,enabled,relationships_only) values('81000000-0000-4000-8000-000000000040',true,true);
set local role authenticated;
select pg_temp.who('p8.merge.machine@synthetic.test','81000000-0000-4000-8000-000000000040');
select pg_temp.expect(pg_temp.state($q$select public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000020')$q$)='42501','machine cannot merge');
select pg_temp.who('p8.merge.disabled@synthetic.test');
select pg_temp.expect(pg_temp.state($q$select public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000020')$q$)='42501','disabled member cannot merge');
select pg_temp.who('p8.outside@synthetic.test');
select pg_temp.expect(pg_temp.state($q$select public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000020')$q$)='42501','nonmember cannot merge');
reset role;
set local role anon;
select pg_temp.expect(pg_temp.state($q$select public.merge_people('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000020')$q$)='42501','anon cannot merge');
reset role;
rollback;
