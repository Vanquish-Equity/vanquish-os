-- Admin access is independent from Portfolio and Documents. Requires 0022.
do $$ begin
  if to_regprocedure('public.set_my_display_name(text)') is null then
    raise exception '0023 requires migration 0022';
  end if;
end $$;

alter table public.member_permissions drop constraint if exists member_permissions_permission_check;
alter table public.member_permissions add constraint member_permissions_permission_check
  check (permission in ('portfolio', 'documents', 'admin'));

insert into public.member_permissions (email, permission)
values ('marios@vanquishequity.com', 'admin') on conflict do nothing;

drop policy if exists app_members_select_own on public.app_members;
create policy app_members_select_own on public.app_members for select to authenticated
using (email = (select private.current_email()) or (select private.has_permission('admin')));

drop policy if exists member_permissions_select_own on public.member_permissions;
create policy member_permissions_select_own on public.member_permissions for select to authenticated
using (email = (select private.current_email()) or (select private.has_permission('admin')));

create table if not exists public.ignored_email_domains (
  domain text primary key,
  reason text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);
alter table public.ignored_email_domains enable row level security;
revoke all on public.ignored_email_domains from public, anon, authenticated;
grant select on public.ignored_email_domains to authenticated;
drop policy if exists ignored_email_domains_admin_read on public.ignored_email_domains;
create policy ignored_email_domains_admin_read on public.ignored_email_domains for select to authenticated
using ((select private.has_permission('admin')));

create or replace function public.admin_set_member_active(p_email text, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin text := private.require_member();
begin
  if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_active is null or lower(btrim(p_email)) = v_admin then raise exception 'invalid member change' using errcode='22023'; end if;
  update public.app_members set is_active=p_active where email=lower(btrim(p_email));
  if not found then raise exception 'member not found' using errcode='22023'; end if;
end $$;
revoke all on function public.admin_set_member_active(text,boolean) from public,anon;
grant execute on function public.admin_set_member_active(text,boolean) to authenticated;

create or replace function public.admin_set_member_permission(p_email text, p_permission text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member();
  if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_permission not in ('portfolio','documents') or p_enabled is null then
    raise exception 'invalid permission' using errcode='22023';
  end if;
  if not exists (select 1 from public.app_members where email=lower(btrim(p_email))) then
    raise exception 'member not found' using errcode='22023';
  end if;
  if p_enabled then
    insert into public.member_permissions (email,permission) values (lower(btrim(p_email)),p_permission) on conflict do nothing;
  else
    delete from public.member_permissions where email=lower(btrim(p_email)) and permission=p_permission;
  end if;
end $$;
revoke all on function public.admin_set_member_permission(text,text,boolean) from public,anon;
grant execute on function public.admin_set_member_permission(text,text,boolean) to authenticated;

create or replace function public.admin_save_ignored_domain(p_domain text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_admin text := private.require_member();
        v_domain text := lower(btrim(coalesce(p_domain,'')));
        v_reason text := btrim(coalesce(p_reason,''));
begin
  if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
  if length(v_domain)>253 or v_domain !~ '^[a-z0-9]+([.-][a-z0-9]+)*\.[a-z]{2,}$' or length(v_reason)>200 then
    raise exception 'invalid domain or reason' using errcode='22023';
  end if;
  insert into public.ignored_email_domains (domain,reason,created_by)
  values (v_domain,v_reason,v_admin)
  on conflict (domain) do update set reason=excluded.reason;
end $$;
revoke all on function public.admin_save_ignored_domain(text,text) from public,anon;
grant execute on function public.admin_save_ignored_domain(text,text) to authenticated;

create or replace function public.admin_delete_ignored_domain(p_domain text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member();
  if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
  delete from public.ignored_email_domains where domain=lower(btrim(p_domain));
end $$;
revoke all on function public.admin_delete_ignored_domain(text) from public,anon;
grant execute on function public.admin_delete_ignored_domain(text) to authenticated;
