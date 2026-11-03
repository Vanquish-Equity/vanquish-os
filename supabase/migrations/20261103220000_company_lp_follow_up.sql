begin;
-- Shared company flag, using the same membership and machine-identity policies as the company row.
alter table public.companies add column if not exists lp_follow_up boolean not null default false;
commit;
