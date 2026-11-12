-- Disposable fixture installed before P11. Existing flags must not become consent.
-- Used only by the local/CI SQL chain, never production.
insert into public.app_members(email,display_name)
select 'p11.legacy-'||n||'@synthetic.test','Synthetic Legacy' from generate_series(1,5)n;
insert into public.member_permissions(email,permission)
select email,'email_scouting' from public.app_members where email like 'p11.legacy-%';
insert into public.google_mailbox_connections(email,granted_scopes,refresh_token_encrypted,refresh_token_iv,refresh_token_tag)
select email,array['https://www.googleapis.com/auth/gmail.readonly'],'synthetic','synthetic','synthetic'
from public.app_members where email like 'p11.legacy-%';
insert into private.company_scout_accounts(email,enabled,next_run_at)
select email,true,'-infinity' from public.app_members where email like 'p11.legacy-%';
insert into private.email_followup_accounts(member_email,enabled,next_run_at)
select email,true,'-infinity' from public.app_members where email like 'p11.legacy-%';
