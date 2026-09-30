-- Two kinds of (future) mailbox connection: members who do company
-- scouting, whose connected Gmail may be scanned to detect and suggest new
-- Companies from their email activity, and members who don't, whose
-- mailbox connection (once it exists) is never scanned for that. This adds
-- the distinction as an ordinary member permission, reusing the existing
-- member_permissions/admin machinery from migration 0023 — it does not by
-- itself turn any scanning on, since no mailbox is connected yet.
-- Requires 0023.

do $$ begin
  if to_regprocedure('public.admin_set_member_permission(text,text,boolean)') is null then
    raise exception '20260929190000 requires migration 0023';
  end if;
end $$;

alter table public.member_permissions drop constraint if exists member_permissions_permission_check;
alter table public.member_permissions add constraint member_permissions_permission_check
  check (permission in ('portfolio', 'documents', 'admin', 'email_scouting'));

-- Widen the admin-facing setter to also allow toggling email_scouting.
-- 'admin' stays out of this list on purpose (unchanged from 0023): it is
-- never grantable through the app, only by direct SQL, so a member cannot
-- escalate their own access.
create or replace function public.admin_set_member_permission(p_email text, p_permission text, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_member();
  if not private.has_permission('admin') then raise exception 'not authorized' using errcode='42501'; end if;
  if p_permission not in ('portfolio','documents','email_scouting') or p_enabled is null then
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
