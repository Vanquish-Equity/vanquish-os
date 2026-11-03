begin;
insert into public.app_members(email,display_name) values
 ('mention.author@synthetic.test','Synthetic author'),
 ('mention.reader@synthetic.test','Synthetic reader'),
 ('mention.other@synthetic.test','Synthetic other');
create temp table mention_ids (id uuid);
grant select, insert on mention_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","email":"mention.author@synthetic.test"}',true);
insert into mention_ids select public.comment_post_visible(
 'home',null,null,null,'home-tasks','Synthetic label',null,'Synthetic private body',
 array['mention.reader@synthetic.test'],array['mention.reader@synthetic.test']);
set constraints all immediate;

do $$begin
  if (select count(*) from public.chat_conversations where kind='direct') <> 1
    or (select count(*) from public.chat_messages m join mention_ids c on m.comment_mention_id=c.id
      where m.author_email='mention.author@synthetic.test' and m.body='Comment mention: /home#comment-'||c.id) <> 1
  then raise exception 'Author cannot see the link-only message in the new direct chat'; end if;
end$$;

select public.comment_edit((select id from mention_ids),'Synthetic edit',array[]::text[]);
select public.comment_edit((select id from mention_ids),'Synthetic edit again',array['mention.reader@synthetic.test']);
do $$begin
  if (select count(*) from public.chat_messages m join mention_ids c on m.comment_mention_id=c.id) <> 1
  then raise exception 'An edited mention produced a duplicate chat entry'; end if;
end$$;

select set_config('request.jwt.claims','{"role":"authenticated","email":"mention.reader@synthetic.test"}',true);
do $$begin
  if (select count(*) from public.chat_messages m join mention_ids c on m.comment_mention_id=c.id) <> 1
    or (select count(*) from public.chat_unread_counts() where unread=1) <> 1
    or (select count(*) from public.notifications where recipient_email='mention.reader@synthetic.test') <> 1
  then raise exception 'Recipient did not get one unread chat entry and one bell notice'; end if;
end$$;

select set_config('request.jwt.claims','{"role":"authenticated","email":"mention.other@synthetic.test"}',true);
do $$begin
  if exists(select 1 from public.chat_messages m join mention_ids c on m.comment_mention_id=c.id)
  then raise exception 'A third member could read the chat entry'; end if;
end$$;

select set_config('request.jwt.claims','{"role":"authenticated","email":"mention.author@synthetic.test"}',true);
select public.comment_delete((select id from mention_ids));
do $$begin
  if exists(select 1 from public.chat_messages m join mention_ids c on m.comment_mention_id=c.id)
  then raise exception 'The deleted comment link is still visible'; end if;
end$$;
rollback;
