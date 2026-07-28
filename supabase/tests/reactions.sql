\set ON_ERROR_STOP on

-- Invariants for likes, one level replies, in-app notifications and sharing a
-- post with the circle it already belongs to.

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '50000000-0000-0000-0000-000000000001',
    'reaction-author@example.com',
    pg_catalog.now(),
    '{"display_name":"Author"}'::jsonb
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    'reaction-fan@example.com',
    pg_catalog.now(),
    '{"display_name":"Fan"}'::jsonb
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    'reaction-second-fan@example.com',
    pg_catalog.now(),
    '{"display_name":"Second Fan"}'::jsonb
  ),
  (
    '50000000-0000-0000-0000-000000000004',
    'reaction-admin@example.com',
    pg_catalog.now(),
    '{"display_name":"Admin"}'::jsonb
  ),
  (
    '50000000-0000-0000-0000-000000000005',
    'reaction-outsider@example.com',
    pg_catalog.now(),
    '{"display_name":"Outsider"}'::jsonb
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);
select public.create_group('Reaction Circle') as group_a_id \gset
select public.create_post(:'group_a_id'::uuid, '今日のライブ最高だった')
  as post_a_id \gset
reset role;

insert into public.memberships (group_id, user_id, role)
values
  (
    :'group_a_id'::uuid,
    '50000000-0000-0000-0000-000000000002',
    'member'
  ),
  (
    :'group_a_id'::uuid,
    '50000000-0000-0000-0000-000000000003',
    'member'
  ),
  (
    :'group_a_id'::uuid,
    '50000000-0000-0000-0000-000000000004',
    'admin'
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000003',
  true
);
select public.create_post(:'group_a_id'::uuid, 'わたしの投稿') as post_c_id \gset
reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000005',
  true
);
select public.create_group('Other Circle') as group_b_id \gset
select public.create_post(:'group_b_id'::uuid, '別の輪の投稿') as post_b_id \gset
reset role;

select pg_catalog.set_config('test.group_a_id', :'group_a_id', true);
select pg_catalog.set_config('test.group_b_id', :'group_b_id', true);
select pg_catalog.set_config('test.post_a_id', :'post_a_id', true);
select pg_catalog.set_config('test.post_b_id', :'post_b_id', true);
select pg_catalog.set_config('test.post_c_id', :'post_c_id', true);
select pg_catalog.set_config(
  'test.author_id',
  '50000000-0000-0000-0000-000000000001',
  true
);
select pg_catalog.set_config(
  'test.fan_id',
  '50000000-0000-0000-0000-000000000002',
  true
);
select pg_catalog.set_config(
  'test.second_fan_id',
  '50000000-0000-0000-0000-000000000003',
  true
);
select pg_catalog.set_config(
  'test.admin_id',
  '50000000-0000-0000-0000-000000000004',
  true
);
select pg_catalog.set_config(
  'test.outsider_id',
  '50000000-0000-0000-0000-000000000005',
  true
);

-- A reply can never grow a second level, because there is nowhere to put a
-- parent reply. This is checked as a shape rather than as a refusal: a column
-- that does not exist cannot be filled in by a future code path.
do $assert$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'post_replies'
      and column_name in ('parent_reply_id', 'parent_id', 'reply_id', 'depth')
  ) then
    raise exception 'post_replies carries a parent reference: replies can nest';
  end if;
end
$assert$;

-- Anonymous callers reach neither the tables nor the RPCs.
set role anon;

do $assert$
begin
  begin
    perform pg_catalog.count(*) from public.post_likes;
    raise exception 'anon unexpectedly selected public.post_likes';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform pg_catalog.count(*) from public.notifications;
    raise exception 'anon unexpectedly selected public.notifications';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.toggle_post_like(
      pg_catalog.current_setting('test.post_a_id')::uuid
    );
    raise exception 'anon unexpectedly executed toggle_post_like';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

-- Direct table DML stays unreachable: every reaction is written by an RPC that
-- locks the group and re-checks membership first.
do $assert$
begin
  begin
    insert into public.post_likes (group_id, post_id, user_id)
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      auth.uid()
    );
    raise exception 'member unexpectedly inserted into public.post_likes';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into public.post_replies (group_id, post_id, author_id, body)
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      auth.uid(),
      'direct insert'
    );
    raise exception 'member unexpectedly inserted into public.post_replies';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into public.post_shares (group_id, post_id, shared_by)
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      auth.uid()
    );
    raise exception 'member unexpectedly inserted into public.post_shares';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into public.notifications (
      group_id,
      recipient_id,
      actor_id,
      kind,
      post_id
    )
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      pg_catalog.current_setting('test.author_id')::uuid,
      auth.uid(),
      'like',
      pg_catalog.current_setting('test.post_a_id')::uuid
    );
    raise exception 'member unexpectedly inserted into public.notifications';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    update public.notifications as notification
    set read_at = pg_catalog.now()
    where notification.id is not null;
    raise exception 'member unexpectedly updated public.notifications';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- Liking is a toggle, and the same like can never be counted twice.
do $assert$
declare
  liked boolean;
  like_count bigint;
begin
  liked := public.toggle_post_like(
    pg_catalog.current_setting('test.post_a_id')::uuid
  );

  if not liked then
    raise exception 'the first like reported the post as unliked';
  end if;

  select pg_catalog.count(*)
  into like_count
  from public.post_likes as entry
  where entry.post_id = pg_catalog.current_setting('test.post_a_id')::uuid;

  if like_count <> 1 then
    raise exception 'one like produced % rows', like_count;
  end if;
end
$assert$;

reset role;

-- The author's notifications are not the admirer's to read, so every check on
-- them looks at the rows themselves rather than through a member's eyes.
do $assert$
declare
  notification record;
begin
  select * into notification
  from public.notifications as entry
  where entry.post_id = pg_catalog.current_setting('test.post_a_id')::uuid
    and entry.kind = 'like';

  if not found then
    raise exception 'the like notified nobody';
  end if;

  if notification.recipient_id
      <> pg_catalog.current_setting('test.author_id')::uuid
    or notification.actor_id
      <> pg_catalog.current_setting('test.fan_id')::uuid
    or notification.read_at is not null
  then
    raise exception 'the like notification named the wrong people';
  end if;
end
$assert$;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  like_count bigint;
begin
  if public.toggle_post_like(
    pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the second toggle reported the post as still liked';
  end if;

  select pg_catalog.count(*)
  into like_count
  from public.post_likes as entry
  where entry.post_id = pg_catalog.current_setting('test.post_a_id')::uuid;

  if like_count <> 0 then
    raise exception 'withdrawing the like left % rows', like_count;
  end if;
end
$assert$;

reset role;

do $assert$
declare
  notification_count bigint;
begin
  -- An unread notification about a like that is no longer there is a lie.
  select pg_catalog.count(*)
  into notification_count
  from public.notifications as notification
  where notification.post_id
      = pg_catalog.current_setting('test.post_a_id')::uuid
    and notification.kind = 'like';

  if notification_count <> 0 then
    raise exception
      'withdrawing the like left % notifications',
      notification_count;
  end if;
end
$assert$;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  if not public.toggle_post_like(
    pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the post could not be liked again';
  end if;
end
$assert$;

reset role;

-- Once the author has read the notification it is a record of something that
-- happened, so withdrawing the like leaves it alone and liking again does not
-- repeat it.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);

do $assert$
declare
  marked bigint;
begin
  marked := public.mark_notifications_read();

  if marked <> 1 then
    raise exception 'the author marked % notifications read', marked;
  end if;

  if public.count_unread_notifications() <> 0 then
    raise exception 'the author still has unread notifications';
  end if;
end
$assert$;

reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  perform public.toggle_post_like(
    pg_catalog.current_setting('test.post_a_id')::uuid
  );
  perform public.toggle_post_like(
    pg_catalog.current_setting('test.post_a_id')::uuid
  );
end
$assert$;

reset role;

do $assert$
declare
  notification_count bigint;
  unread_count bigint;
begin
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where entry.read_at is null)
  into notification_count, unread_count
  from public.notifications as entry
  where entry.post_id = pg_catalog.current_setting('test.post_a_id')::uuid
    and entry.kind = 'like';

  if notification_count <> 1 then
    raise exception
      'liking again after the author read it produced % notifications',
      notification_count;
  end if;

  if unread_count <> 0 then
    raise exception 'the notification the author had read came back unread';
  end if;
end
$assert$;

-- Liking your own post is allowed; being told about it is not.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);

do $assert$
begin
  perform public.toggle_post_like(
    pg_catalog.current_setting('test.post_a_id')::uuid
  );

  if exists (
    select 1
    from public.notifications as notification
    where notification.recipient_id = auth.uid()
      and notification.actor_id = auth.uid()
  ) then
    raise exception 'the author was notified about their own like';
  end if;
end
$assert$;

reset role;

-- The group boundary: a post in another circle answers as if it did not exist.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000005',
  true
);

do $assert$
begin
  begin
    perform public.toggle_post_like(
      pg_catalog.current_setting('test.post_a_id')::uuid
    );
    raise exception 'an outsider liked a post in a circle they are not in';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.create_reply(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      'こんにちは'
    );
    raise exception 'an outsider replied in a circle they are not in';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.share_post(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.group_b_id')::uuid
    );
    raise exception 'an outsider shared a post from another circle';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

-- Replies: written by members, validated, and announced to the post author.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  reply_id uuid;
begin
  begin
    perform public.create_reply(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      '   '
    );
    raise exception 'a blank reply was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_reply(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.repeat('あ', 1001)
    );
    raise exception 'an over long reply was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_reply(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      'zero' || pg_catalog.chr(8) || 'width'
    );
    raise exception 'a reply with control characters was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  reply_id := public.create_reply(
    pg_catalog.current_setting('test.post_a_id')::uuid,
    '  わたしも行きたかった  '
  );

  if not exists (
    select 1
    from public.post_replies as reply
    where reply.id = reply_id
      and reply.body = 'わたしも行きたかった'
      and reply.group_id = pg_catalog.current_setting('test.group_a_id')::uuid
  ) then
    raise exception 'the reply was not stored trimmed and inside its group';
  end if;

  perform pg_catalog.set_config('test.reply_id', reply_id::text, true);
end
$assert$;

reset role;

do $assert$
declare
  notification record;
begin
  select * into notification
  from public.notifications as entry
  where entry.kind = 'reply'
    and entry.reply_id = pg_catalog.current_setting('test.reply_id')::uuid;

  if not found then
    raise exception 'the reply notified nobody';
  end if;

  if notification.recipient_id
      <> pg_catalog.current_setting('test.author_id')::uuid
    or notification.actor_id
      <> pg_catalog.current_setting('test.fan_id')::uuid
  then
    raise exception 'the reply notification named the wrong people';
  end if;
end
$assert$;

-- Replying to your own post notifies nobody.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);

do $assert$
declare
  unread_before bigint := public.count_unread_notifications();
begin
  perform public.create_reply(
    pg_catalog.current_setting('test.post_a_id')::uuid,
    'ありがとう'
  );

  if public.count_unread_notifications() <> unread_before then
    raise exception 'replying to your own post notified you';
  end if;
end
$assert$;

reset role;

-- Removing a reply follows the same rule as removing a post: the person who
-- wrote it, or somebody who moderates the circle.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000003',
  true
);

do $assert$
begin
  begin
    perform public.delete_reply(
      pg_catalog.current_setting('test.reply_id')::uuid
    );
    raise exception 'a plain member removed somebody else''s reply';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000004',
  true
);

do $assert$
begin
  if not public.delete_reply(
    pg_catalog.current_setting('test.reply_id')::uuid
  ) then
    raise exception 'an admin could not moderate a reply';
  end if;

  if exists (
    select 1
    from public.post_replies as reply
    where reply.id = pg_catalog.current_setting('test.reply_id')::uuid
  ) then
    raise exception 'the reply outlived its removal';
  end if;
end
$assert$;

reset role;

do $assert$
begin
  -- A notification pointing at a reply that no longer exists opens onto
  -- nothing, so it goes with the reply.
  if exists (
    select 1
    from public.notifications as notification
    where notification.reply_id
      = pg_catalog.current_setting('test.reply_id')::uuid
  ) then
    raise exception 'the notification outlived the reply it pointed at';
  end if;
end
$assert$;

-- Sharing: only into the circle the post already belongs to, once, and every
-- other member hears about it.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  share_id uuid;
begin
  begin
    perform public.share_post(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.group_b_id')::uuid
    );
    raise exception 'a post was shared into another circle';
  exception
    when invalid_parameter_value then
      null;
  end;

  share_id := public.share_post(
    pg_catalog.current_setting('test.post_a_id')::uuid,
    pg_catalog.current_setting('test.group_a_id')::uuid,
    'これ見て'
  );

  if not exists (
    select 1
    from public.post_shares as share
    where share.id = share_id
      and share.note = 'これ見て'
      and share.group_id = pg_catalog.current_setting('test.group_a_id')::uuid
  ) then
    raise exception 'the share was not stored inside its own group';
  end if;

  begin
    perform public.share_post(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.group_a_id')::uuid
    );
    raise exception 'the same post was shared twice by the same member';
  exception
    when invalid_parameter_value then
      null;
  end;

end
$assert$;

reset role;

-- Sharing is how a member says "look at this", so it reaches the rest of the
-- circle rather than only the author, and never the sharer.
do $assert$
declare
  recipients uuid[];
begin
  select pg_catalog.array_agg(
    notification.recipient_id order by notification.recipient_id
  )
  into recipients
  from public.notifications as notification
  where notification.kind = 'share'
    and notification.post_id
      = pg_catalog.current_setting('test.post_a_id')::uuid;

  if recipients is distinct from array[
    pg_catalog.current_setting('test.author_id')::uuid,
    pg_catalog.current_setting('test.second_fan_id')::uuid,
    pg_catalog.current_setting('test.admin_id')::uuid
  ] then
    raise exception 'the share reached % rather than the rest of the circle',
      recipients;
  end if;
end
$assert$;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  if not public.unshare_post(
    pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the sharer could not withdraw their own share';
  end if;
end
$assert$;

reset role;

do $assert$
begin
  if exists (
    select 1
    from public.notifications as notification
    where notification.kind = 'share'
      and notification.post_id
        = pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'withdrawing the share left its notifications behind';
  end if;
end
$assert$;

-- A group id and a post id from different circles cannot be written together,
-- even by a role that bypasses every policy.
do $assert$
begin
  begin
    insert into public.post_likes (group_id, post_id, user_id)
    values (
      pg_catalog.current_setting('test.group_b_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.outsider_id')::uuid
    );
    raise exception 'a like joined a post to another group';
  exception
    when foreign_key_violation then
      null;
  end;

  begin
    insert into public.post_replies (group_id, post_id, author_id, body)
    values (
      pg_catalog.current_setting('test.group_b_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.outsider_id')::uuid,
      'cross group'
    );
    raise exception 'a reply joined a post to another group';
  exception
    when foreign_key_violation then
      null;
  end;

  begin
    insert into public.post_shares (group_id, post_id, shared_by)
    values (
      pg_catalog.current_setting('test.group_b_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.outsider_id')::uuid
    );
    raise exception 'a share joined a post to another group';
  exception
    when foreign_key_violation then
      null;
  end;

  begin
    insert into public.notifications (
      group_id,
      recipient_id,
      actor_id,
      kind,
      post_id
    )
    values (
      pg_catalog.current_setting('test.group_b_id')::uuid,
      pg_catalog.current_setting('test.outsider_id')::uuid,
      pg_catalog.current_setting('test.fan_id')::uuid,
      'share',
      pg_catalog.current_setting('test.post_a_id')::uuid
    );
    raise exception 'a notification joined a post to another group';
  exception
    when foreign_key_violation then
      null;
  end;

  -- Nobody is notified about their own doing, whatever the caller says.
  begin
    insert into public.notifications (
      group_id,
      recipient_id,
      actor_id,
      kind,
      post_id
    )
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      pg_catalog.current_setting('test.fan_id')::uuid,
      pg_catalog.current_setting('test.fan_id')::uuid,
      'share',
      pg_catalog.current_setting('test.post_a_id')::uuid
    );
    raise exception 'a notification was addressed to its own actor';
  exception
    when check_violation then
      null;
  end;
end
$assert$;

-- The timeline answers each viewer about their own reaction, and reports the
-- totals for everybody.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  entry record;
  index integer;
begin
  select * into entry
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_a_id')::uuid
  ) as listed
  where listed.id = pg_catalog.current_setting('test.post_a_id')::uuid;

  -- The author liked their own post, and the fan's like is still standing.
  if entry.like_count <> 2 then
    raise exception 'the timeline reported % likes instead of 2',
      entry.like_count;
  end if;

  if not entry.liked_by_viewer then
    raise exception 'the timeline told the fan they had not liked the post';
  end if;

  if entry.reply_count <> 1 then
    raise exception 'the timeline reported % replies instead of 1',
      entry.reply_count;
  end if;

  if entry.share_count <> 0 or entry.shared_by_viewer then
    raise exception 'the timeline reported a share that was withdrawn';
  end if;

  -- Four more replies, so the timeline has to carry the newest three and say
  -- how many there are in total.
  for index in 1..4 loop
    perform public.create_reply(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      '返信' || index::text
    );
  end loop;
end
$assert$;

reset role;

-- Every row written in one transaction shares now(), so the conversation's
-- clock is set by hand. Without this the cap would be measured against an
-- arbitrary order and would prove nothing.
update public.post_replies as reply
set created_at = timestamptz '2026-07-28 09:00:00+00'
where reply.body = 'ありがとう';
update public.post_replies as reply
set created_at = timestamptz '2026-07-28 10:00:00+00'
where reply.body = '返信1';
update public.post_replies as reply
set created_at = timestamptz '2026-07-28 11:00:00+00'
where reply.body = '返信2';
update public.post_replies as reply
set created_at = timestamptz '2026-07-28 12:00:00+00'
where reply.body = '返信3';
update public.post_replies as reply
set created_at = timestamptz '2026-07-28 13:00:00+00'
where reply.body = '返信4';

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  entry record;
begin
  select * into entry
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_a_id')::uuid
  ) as listed
  where listed.id = pg_catalog.current_setting('test.post_a_id')::uuid;

  if entry.reply_count <> 5 then
    raise exception 'the timeline reported % replies instead of 5',
      entry.reply_count;
  end if;

  if pg_catalog.jsonb_array_length(entry.replies) <> 3 then
    raise exception 'the timeline carried % replies instead of 3',
      pg_catalog.jsonb_array_length(entry.replies);
  end if;

  -- Capped at the newest three, but read oldest first like a conversation.
  if entry.replies -> 0 ->> 'body' <> '返信2'
    or entry.replies -> 2 ->> 'body' <> '返信4'
  then
    raise exception 'the carried replies were not the newest three in order';
  end if;

  select * into entry
  from public.get_group_post(
    pg_catalog.current_setting('test.post_a_id')::uuid
  );

  if pg_catalog.jsonb_array_length(entry.replies) <> 5 then
    raise exception 'the post page carried % replies instead of 5',
      pg_catalog.jsonb_array_length(entry.replies);
  end if;
end
$assert$;

reset role;

-- The post page is a read like any other: an outsider finds nothing.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000005',
  true
);

do $assert$
declare
  visible bigint;
begin
  select pg_catalog.count(*)
  into visible
  from public.get_group_post(
    pg_catalog.current_setting('test.post_a_id')::uuid
  );

  if visible <> 0 then
    raise exception 'an outsider read a post from another circle';
  end if;
end
$assert$;

reset role;

-- One member's notifications are invisible to everybody else, and marking
-- them read reaches nothing but their own.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  perform public.create_reply(
    pg_catalog.current_setting('test.post_a_id')::uuid,
    'まだ話したい'
  );

  if exists (
    select 1
    from public.notifications as notification
    where notification.recipient_id
      = pg_catalog.current_setting('test.author_id')::uuid
  ) then
    raise exception 'a member read another member''s notifications';
  end if;

  perform public.mark_notifications_read();
end
$assert$;

reset role;

do $assert$
begin
  if not exists (
    select 1
    from public.notifications as notification
    join public.post_replies as reply on reply.id = notification.reply_id
    where notification.recipient_id
        = pg_catalog.current_setting('test.author_id')::uuid
      and reply.body = 'まだ話したい'
      and notification.read_at is null
  ) then
    raise exception
      'one member marking their list read reached another member''s';
  end if;
end
$assert$;

-- The notification list names who acted and what they touched.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);

do $assert$
declare
  entry record;
begin
  if not exists (select 1 from public.list_notifications()) then
    raise exception 'the author has no notifications to read';
  end if;

  if exists (
    select 1
    from public.list_notifications() as listed
    where listed.actor_id = auth.uid()
  ) then
    raise exception 'the notification list included the reader''s own doing';
  end if;

  select * into entry
  from public.list_notifications() as listed
  where listed.kind = 'reply'
  limit 1;

  if not found then
    raise exception 'the reply notifications are missing from the list';
  end if;

  if entry.actor_name is null
    or entry.group_name <> 'Reaction Circle'
    or entry.post_excerpt is null
    or entry.reply_body is null
  then
    raise exception 'a notification arrived without enough to describe it';
  end if;
end
$assert$;

reset role;

-- Leaving the circle takes its notifications out of sight. They are hidden by
-- the policy rather than deleted: rejoining should not have to rebuild them.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000002',
  true
);
select public.toggle_post_like(:'post_c_id'::uuid) as liked_post_c \gset
reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000003',
  true
);

do $assert$
begin
  if public.count_unread_notifications() <> 1 then
    raise exception 'the like on their own post did not reach its author';
  end if;
end
$assert$;

reset role;

delete from public.memberships as membership
where membership.group_id = pg_catalog.current_setting('test.group_a_id')::uuid
  and membership.user_id
    = pg_catalog.current_setting('test.second_fan_id')::uuid;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000003',
  true
);

do $assert$
begin
  if public.count_unread_notifications() <> 0 then
    raise exception 'a former member still counts the circle''s notifications';
  end if;

  if exists (select 1 from public.list_notifications()) then
    raise exception 'a former member still lists the circle''s notifications';
  end if;
end
$assert$;

reset role;

do $assert$
begin
  if not exists (
    select 1
    from public.notifications as notification
    where notification.recipient_id
      = pg_catalog.current_setting('test.second_fan_id')::uuid
  ) then
    raise exception 'losing membership deleted the notification rows';
  end if;
end
$assert$;

-- Removing the post takes every reaction to it with it.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '50000000-0000-0000-0000-000000000001',
  true
);
select public.share_post(
  :'post_a_id'::uuid,
  :'group_a_id'::uuid
) as final_share_id \gset
select public.delete_post(:'post_a_id'::uuid) as orphaned_paths \gset
reset role;

do $assert$
begin
  if exists (
    select 1
    from public.post_likes as entry
    where entry.post_id = pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the likes outlived their post';
  end if;

  if exists (
    select 1
    from public.post_replies as reply
    where reply.post_id = pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the replies outlived their post';
  end if;

  if exists (
    select 1
    from public.post_shares as share
    where share.post_id = pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the shares outlived their post';
  end if;

  if exists (
    select 1
    from public.notifications as notification
    where notification.post_id
      = pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the notifications outlived their post';
  end if;
end
$assert$;

rollback;
