-- Member-controlled display names and private profile photos. Depends on 0016.
do $$ begin
  if to_regclass('public.app_members') is null
     or to_regprocedure('private.require_member()') is null then
    raise exception '0022 requires migration 0016';
  end if;
end $$;

alter table public.app_members add column if not exists avatar_path text;

insert into storage.buckets (id, name, public)
values ('member-avatars', 'member-avatars', false)
on conflict (id) do update set public = false;

drop policy if exists member_avatars_select on storage.objects;
create policy member_avatars_select on storage.objects for select to authenticated
using (bucket_id = 'member-avatars' and (select private.is_member())
  and split_part(name, '/', 1) = (select auth.uid())::text);

drop policy if exists member_avatars_insert on storage.objects;
create policy member_avatars_insert on storage.objects for insert to authenticated
with check (bucket_id = 'member-avatars' and (select private.is_member())
  and split_part(name, '/', 1) = (select auth.uid())::text);

drop policy if exists member_avatars_delete on storage.objects;
create policy member_avatars_delete on storage.objects for delete to authenticated
using (bucket_id = 'member-avatars' and (select private.is_member())
  and split_part(name, '/', 1) = (select auth.uid())::text);

create or replace function public.set_my_display_name(p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := private.require_member();
        v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) not between 1 and 80 or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid display name' using errcode = '22023';
  end if;
  update public.app_members set display_name = v_name where email = v_email;
end $$;
revoke all on function public.set_my_display_name(text) from public, anon;
grant execute on function public.set_my_display_name(text) to authenticated;

create or replace function public.set_my_avatar(p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := private.require_member();
        v_prefix text := (select auth.uid())::text || '/';
begin
  if p_path is not null and (
    p_path not like v_prefix || 'avatar-%' or
    p_path !~ ('^' || (select auth.uid())::text || '/avatar-[0-9a-f-]{36}\.(png|jpg|webp)$') or
    not exists (select 1 from storage.objects
      where bucket_id = 'member-avatars' and name = p_path)
  ) then
    raise exception 'invalid avatar' using errcode = '22023';
  end if;
  update public.app_members set avatar_path = p_path where email = v_email;
end $$;
revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;
