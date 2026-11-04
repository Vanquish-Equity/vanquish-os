begin;
create table if not exists private.mail_open_signals (
 review_id uuid primary key references private.mail_mutation_reviews(id) on delete cascade,
 digest text not null unique check(digest ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null default (now() + interval '30 days'),
 first_seen timestamptz
);
alter table private.mail_open_signals enable row level security;
revoke all on private.mail_open_signals from public, anon, authenticated;
drop policy if exists machine_identity_isolation on private.mail_open_signals;
create policy machine_identity_isolation on private.mail_open_signals as restrictive for all to authenticated
 using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));

create or replace function public.register_mail_open_signal(p_review uuid,p_revision text,p_digest text)
returns void language plpgsql security definer set search_path='' as $$
declare ctx jsonb;
begin
 ctx := private.mail_completion_access(true);
 perform 1 from private.mail_mutation_reviews where id=p_review
 and owner_email=private.current_email() and operation='send' and state='claimed'
 and revision=p_revision and connection_revision=ctx->>'connectionRevision'
 and dispatch_started_at is null and expires_at>now() for update;
 if not found then raise exception 'Mail review unavailable' using errcode='42501'; end if;
 insert into private.mail_open_signals(review_id,digest) values(p_review,p_digest);
end $$;
create or replace function public.record_mail_open_signal(p_digest text)
returns void language sql security definer set search_path='' as $$
 update private.mail_open_signals s set first_seen=now()
 where s.digest=p_digest and s.first_seen is null and s.expires_at>now()
 and exists(select 1 from private.mail_mutation_reviews r where r.id=s.review_id
   and r.operation='send' and r.dispatch_started_at is not null and r.state in ('claimed','completed'))
 and exists(select 1 from private.mail_completion_configuration where singleton and enabled);
$$;
create or replace function public.my_mail_open_signals()
returns table(review_id uuid, first_seen timestamptz) language plpgsql security definer set search_path='' as $$
begin
 perform private.mail_completion_access(false);
 return query select s.review_id,s.first_seen from private.mail_open_signals s
 join private.mail_mutation_reviews r on r.id=s.review_id
 where r.owner_email=private.current_email() and r.state='completed' and s.expires_at>now()
 order by r.created_at desc limit 25;
end $$;
revoke all on function public.register_mail_open_signal(uuid,text,text),public.record_mail_open_signal(text),public.my_mail_open_signals() from public,anon,authenticated;
grant execute on function public.register_mail_open_signal(uuid,text,text),public.my_mail_open_signals() to authenticated;
grant execute on function public.record_mail_open_signal(text) to anon;
commit;
