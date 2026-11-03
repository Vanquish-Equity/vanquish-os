begin;
create table private.mail_open_tracking(
 review_id uuid primary key references private.mail_mutation_reviews(id) on delete cascade,
 person_id uuid not null references public.people(id) on delete cascade,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null default now()+interval '30 days'
);
create index mail_open_tracking_person on private.mail_open_tracking(person_id,review_id);
create table private.mail_open_signals(
 review_id uuid not null references private.mail_open_tracking(review_id) on delete cascade,
 hour_at timestamptz not null,
 automated boolean not null,
 detected_at timestamptz not null default now(),
 primary key(review_id,hour_at,automated)
);
alter table private.mail_open_tracking enable row level security;
alter table private.mail_open_signals enable row level security;
revoke all on private.mail_open_tracking,private.mail_open_signals from public,anon,authenticated;
create policy machine_identity_isolation on private.mail_open_tracking as restrictive to authenticated
 using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));
create policy machine_identity_isolation on private.mail_open_signals as restrictive to authenticated
 using ((select not private.is_machine_identity())) with check ((select not private.is_machine_identity()));

create function public.register_mail_open_tracking(p_review uuid,p_revision text,p_recipient text,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 if private.is_machine_identity() or not private.is_member() or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
  or not exists(select 1 from private.mail_mutation_reviews r where r.id=p_review and r.owner_email=private.current_email()
   and r.operation='send' and r.state='claimed' and r.dispatch_started_at is null and r.revision=p_revision and r.expires_at>now())
 then raise exception 'Tracking unavailable' using errcode='42501'; end if;
 select p.id into person from public.people p join public.person_emails e on e.person_id=p.id
 where e.email=lower(p_recipient) and p.archived_at is null;
 if person is null then raise exception 'Choose a saved contact for tracking' using errcode='22023'; end if;
 insert into private.mail_open_tracking(review_id,person_id,token_hash) values(p_review,person,p_hash);
end$$;

create function public.record_mail_open_signal(p_hash text,p_automated boolean)
returns void language sql security definer set search_path='' as $$
 insert into private.mail_open_signals(review_id,hour_at,automated)
 select t.review_id,date_trunc('hour',now()),p_automated
 from private.mail_open_tracking t join private.mail_mutation_reviews r on r.id=t.review_id
 join public.people p on p.id=t.person_id and p.archived_at is null
 join public.app_members m on m.email=r.owner_email and m.is_active
 where t.token_hash=p_hash and t.expires_at>now() and r.state='completed'
  and p_automated is not null and not private.is_machine_identity()
 on conflict do nothing
$$;

create function public.person_mail_open_signals(p_person uuid)
returns table(review_id uuid,sent_at timestamptz,detected_at timestamptz,automated boolean)
language sql stable security definer set search_path='' as $$
 select r.id,r.dispatch_started_at,s.detected_at,s.automated
 from private.mail_open_tracking t join private.mail_mutation_reviews r on r.id=t.review_id
 join public.people p on p.id=t.person_id and p.archived_at is null
 left join private.mail_open_signals s on s.review_id=t.review_id
 where t.person_id=p_person and t.expires_at>now() and r.state='completed'
 and r.owner_email=(select private.current_email()) and (select private.is_member())
 and (select not private.is_machine_identity())
 order by r.dispatch_started_at desc,s.detected_at desc nulls last limit 100
$$;
revoke all on function public.register_mail_open_tracking(uuid,text,text,text),public.record_mail_open_signal(text,boolean),public.person_mail_open_signals(uuid) from public,anon,authenticated;
grant execute on function public.register_mail_open_tracking(uuid,text,text,text),public.person_mail_open_signals(uuid) to authenticated;
grant execute on function public.record_mail_open_signal(text,boolean) to anon,authenticated;
commit;
