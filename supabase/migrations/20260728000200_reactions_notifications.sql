begin;

-- Phase 5: likes, one level replies, in-app notifications, and sharing a post
-- with the circle it already belongs to.
--
-- Three of the rules live in the shape of the tables rather than in a check the
-- application might forget:
--
--   * a like is a row keyed by (post_id, user_id), so liking twice is not
--     refused, it is unrepresentable;
--   * a reply has no parent reply column, so a thread cannot grow a second
--     level however the client asks for one;
--   * every table here carries group_id and reaches its post through
--     (group_id, id), so a like, a reply, a share or a notification can never
--     belong to one circle while its post belongs to another.

create type public.notification_kind as enum ('like', 'reply', 'share');

create table public.post_likes (
  group_id uuid not null,
  post_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (post_id, user_id),
  foreign key (group_id, post_id)
    references public.posts (group_id, id) on delete cascade
);

create index post_likes_member_idx on public.post_likes (group_id, user_id);

create table public.post_replies (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null,
  post_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null
    check (
      pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 1000
      and not private.has_unsafe_body_characters(body)
    ),
  created_at timestamptz not null default pg_catalog.now(),
  unique (group_id, id),
  foreign key (group_id, post_id)
    references public.posts (group_id, id) on delete cascade
);

-- A conversation is read oldest first, and always for one post at a time.
create index post_replies_thread_idx
  on public.post_replies (post_id, created_at, id);

create index post_replies_author_idx on public.post_replies (group_id, author_id);

create table public.post_shares (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null,
  post_id uuid not null,
  shared_by uuid not null references public.profiles (id) on delete cascade,
  note text
    check (
      note is null
      or (
        pg_catalog.char_length(pg_catalog.btrim(note)) between 1 and 200
        and not private.has_unsafe_body_characters(note)
      )
    ),
  created_at timestamptz not null default pg_catalog.now(),
  -- Sharing the same post again would only repeat the notification.
  unique (post_id, shared_by),
  foreign key (group_id, post_id)
    references public.posts (group_id, id) on delete cascade
);

create index post_shares_post_idx
  on public.post_shares (post_id, created_at desc);

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  post_id uuid not null,
  reply_id uuid,
  created_at timestamptz not null default pg_catalog.now(),
  read_at timestamptz,
  -- Being told about your own doing is noise. Every write path below skips the
  -- actor; stating it here means no later path can forget to.
  check (recipient_id <> actor_id),
  -- A reply notification without its reply could not be read in context, and a
  -- like or a share has no reply to point at.
  check ((kind = 'reply') = (reply_id is not null)),
  foreign key (group_id, post_id)
    references public.posts (group_id, id) on delete cascade,
  foreign key (group_id, reply_id)
    references public.post_replies (group_id, id) on delete cascade
);

create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc, id desc);

create index notifications_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

create index notifications_post_idx on public.notifications (post_id);

-- One like notification per post and admirer. Withdrawing a like deletes the
-- unread one, so this only bites when the recipient has already read it, and
-- then repeating it would say nothing new.
create unique index notifications_like_once_idx
  on public.notifications (post_id, actor_id)
  where kind = 'like';

create or replace function private.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  -- The read paths below are security invoker on purpose, so that row level
  -- security decides what they may see. That also leaves them with no
  -- privileges of their own, including on the auth schema, so who is asking is
  -- derived here instead of inline.
  select auth.uid()
$function$;

revoke all on function private.current_user_id() from public;

create or replace function private.can_remove_reply(target_reply_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  -- The same rule as removing a post: the person who wrote it, or somebody who
  -- moderates the circle.
  select coalesce(
    exists (
      select 1
      from public.post_replies as reply
      where reply.id = target_reply_id
        and private.is_group_member(reply.group_id)
        and (
          reply.author_id = (select auth.uid())
          or private.has_group_role(
            reply.group_id,
            array['owner', 'admin']::public.membership_role[]
          )
        )
    ),
    false
  )
$function$;

revoke all on function private.can_remove_reply(uuid) from public;

alter table public.post_likes enable row level security;
alter table public.post_likes force row level security;
alter table public.post_replies enable row level security;
alter table public.post_replies force row level security;
alter table public.post_shares enable row level security;
alter table public.post_shares force row level security;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

create policy post_likes_select_members
  on public.post_likes
  for select
  to authenticated
  using (private.is_group_member(group_id));

create policy post_replies_select_members
  on public.post_replies
  for select
  to authenticated
  using (private.is_group_member(group_id));

create policy post_shares_select_members
  on public.post_shares
  for select
  to authenticated
  using (private.is_group_member(group_id));

-- A notification is addressed to one person. Membership is checked as well, so
-- leaving a circle takes its notifications out of sight without deleting them.
create policy notifications_select_recipient
  on public.notifications
  for select
  to authenticated
  using (
    recipient_id = (select auth.uid())
    and private.is_group_member(group_id)
  );

create or replace function private.notify_post_reaction(
  owning_group_id uuid,
  target_recipient_id uuid,
  target_post_id uuid,
  notification_kind public.notification_kind,
  target_reply_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
begin
  if target_recipient_id is null or target_recipient_id = acting_user_id then
    return;
  end if;

  insert into public.notifications (
    group_id,
    recipient_id,
    actor_id,
    kind,
    post_id,
    reply_id
  )
  values (
    owning_group_id,
    target_recipient_id,
    acting_user_id,
    notification_kind,
    target_post_id,
    target_reply_id
  )
  on conflict do nothing;
end
$function$;

revoke all on function private.notify_post_reaction(
  uuid,
  uuid,
  uuid,
  public.notification_kind,
  uuid
) from public;

create or replace function public.toggle_post_like(target_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  owning_group_id uuid;
  post_author_id uuid;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  -- A post in another circle answers exactly as a post that never existed.
  select post.group_id, post.author_id
  into owning_group_id, post_author_id
  from public.posts as post
  where post.id = target_post_id;

  if owning_group_id is null
    or not private.is_group_member(owning_group_id)
  then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.is_group_member(owning_group_id) then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  insert into public.post_likes (group_id, post_id, user_id)
  values (owning_group_id, target_post_id, acting_user_id)
  on conflict (post_id, user_id) do nothing;

  -- No row inserted means the like was already there, so this press withdraws
  -- it. There is no separate unlike RPC to fall out of step with this one.
  if found then
    perform private.notify_post_reaction(
      owning_group_id,
      post_author_id,
      target_post_id,
      'like'
    );

    return true;
  end if;

  delete from public.post_likes as entry
  where entry.post_id = target_post_id
    and entry.user_id = acting_user_id;

  -- An unread notification about a like that is no longer there would be a
  -- lie. One already read is a record of something that did happen.
  delete from public.notifications as notification
  where notification.post_id = target_post_id
    and notification.actor_id = acting_user_id
    and notification.kind = 'like'
    and notification.read_at is null;

  return false;
end
$function$;

revoke all on function public.toggle_post_like(uuid) from public;

create or replace function public.create_reply(
  target_post_id uuid,
  reply_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  normalized_body text := pg_catalog.btrim(reply_body);
  owning_group_id uuid;
  post_author_id uuid;
  recent_reply_count bigint;
  created_reply_id uuid;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if normalized_body is null
    or pg_catalog.char_length(normalized_body) not between 1 and 1000
    or private.has_unsafe_body_characters(normalized_body)
  then
    raise exception using
      errcode = '22023',
      message = 'Reply body must contain 1 to 1000 printable characters';
  end if;

  select post.group_id, post.author_id
  into owning_group_id, post_author_id
  from public.posts as post
  where post.id = target_post_id;

  if owning_group_id is null
    or not private.is_group_member(owning_group_id)
  then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.is_group_member(owning_group_id) then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  -- Every reply notifies the post author, so the quota is what keeps one
  -- session from filling somebody's notification list.
  select pg_catalog.count(*)
  into recent_reply_count
  from public.post_replies as reply
  where reply.group_id = owning_group_id
    and reply.author_id = acting_user_id
    and reply.created_at
      > pg_catalog.statement_timestamp() - interval '1 hour';

  if recent_reply_count >= 120 then
    raise exception using
      errcode = '22023',
      message = 'Hourly reply quota exceeded';
  end if;

  insert into public.post_replies (group_id, post_id, author_id, body)
  values (owning_group_id, target_post_id, acting_user_id, normalized_body)
  returning id into created_reply_id;

  perform private.notify_post_reaction(
    owning_group_id,
    post_author_id,
    target_post_id,
    'reply',
    created_reply_id
  );

  return created_reply_id;
end
$function$;

revoke all on function public.create_reply(uuid, text) from public;

create or replace function public.delete_reply(target_reply_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  owning_group_id uuid;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select reply.group_id
  into owning_group_id
  from public.post_replies as reply
  where reply.id = target_reply_id;

  if owning_group_id is null
    or not private.can_remove_reply(target_reply_id)
  then
    raise exception using
      errcode = '42501',
      message = 'Reply removal permission required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_remove_reply(target_reply_id) then
    raise exception using
      errcode = '42501',
      message = 'Reply removal permission required';
  end if;

  -- The notification that pointed at this reply goes with it by cascade: one
  -- that opens onto nothing would only frustrate whoever taps it.
  delete from public.post_replies as reply
  where reply.id = target_reply_id;

  return found;
end
$function$;

revoke all on function public.delete_reply(uuid) from public;

create or replace function public.share_post(
  target_post_id uuid,
  target_group_id uuid,
  share_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  normalized_note text := nullif(pg_catalog.btrim(share_note), '');
  owning_group_id uuid;
  recent_share_count bigint;
  created_share_id uuid;
  circle_member record;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select post.group_id
  into owning_group_id
  from public.posts as post
  where post.id = target_post_id;

  if owning_group_id is null
    or not private.is_group_member(owning_group_id)
  then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  -- The caller has to name the circle it means, so that carrying a post out of
  -- its own circle is a refusal rather than an oversight. The composite
  -- foreign key would refuse the row anyway; this makes it a validation error.
  if target_group_id is distinct from owning_group_id then
    raise exception using
      errcode = '22023',
      message = 'A post can only be shared inside its own group';
  end if;

  if normalized_note is not null
    and (
      pg_catalog.char_length(normalized_note) > 200
      or private.has_unsafe_body_characters(normalized_note)
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Share note must contain at most 200 printable characters';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.is_group_member(owning_group_id) then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  -- A share reaches everybody in the circle at once, so it is the noisiest
  -- thing a member can do.
  select pg_catalog.count(*)
  into recent_share_count
  from public.post_shares as share
  where share.group_id = owning_group_id
    and share.shared_by = acting_user_id
    and share.created_at
      > pg_catalog.statement_timestamp() - interval '1 hour';

  if recent_share_count >= 30 then
    raise exception using
      errcode = '22023',
      message = 'Hourly share quota exceeded';
  end if;

  if exists (
    select 1
    from public.post_shares as share
    where share.post_id = target_post_id
      and share.shared_by = acting_user_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'This post is already shared';
  end if;

  insert into public.post_shares (group_id, post_id, shared_by, note)
  values (owning_group_id, target_post_id, acting_user_id, normalized_note)
  returning id into created_share_id;

  -- Sharing is how a member says "look at this", so it reaches the circle
  -- rather than only the author. The helper skips the sharer.
  for circle_member in
    select membership.user_id
    from public.memberships as membership
    where membership.group_id = owning_group_id
  loop
    perform private.notify_post_reaction(
      owning_group_id,
      circle_member.user_id,
      target_post_id,
      'share'
    );
  end loop;

  return created_share_id;
end
$function$;

revoke all on function public.share_post(uuid, uuid, text) from public;

create or replace function public.unshare_post(target_post_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  owning_group_id uuid;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select post.group_id
  into owning_group_id
  from public.posts as post
  where post.id = target_post_id;

  if owning_group_id is null
    or not private.is_group_member(owning_group_id)
  then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.is_group_member(owning_group_id) then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  delete from public.post_shares as share
  where share.post_id = target_post_id
    and share.shared_by = acting_user_id;

  if not found then
    return false;
  end if;

  -- Same reasoning as withdrawing a like: an unread pointer to a share that is
  -- no longer there is a lie, and a read one is history.
  delete from public.notifications as notification
  where notification.post_id = target_post_id
    and notification.actor_id = acting_user_id
    and notification.kind = 'share'
    and notification.read_at is null;

  return true;
end
$function$;

revoke all on function public.unshare_post(uuid) from public;

create or replace function public.mark_notifications_read(
  notification_ids uuid[] default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  affected bigint;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  -- This runs as the definer, so the recipient predicate is the whole of the
  -- protection: without it a caller could clear somebody else's list. A null
  -- array means everything still unread.
  update public.notifications as notification
  set read_at = pg_catalog.statement_timestamp()
  where notification.recipient_id = acting_user_id
    and notification.read_at is null
    and (
      notification_ids is null
      or notification.id = any (notification_ids)
    );

  get diagnostics affected = row_count;

  return affected;
end
$function$;

revoke all on function public.mark_notifications_read(uuid[]) from public;

create or replace function public.count_unread_notifications()
returns bigint
language sql
stable
set search_path = ''
as $function$
  -- Security invoker on purpose: the policy already limits the table to the
  -- recipient, and to circles they are still in.
  select pg_catalog.count(*)
  from public.notifications as notification
  where notification.recipient_id = private.current_user_id()
    and notification.read_at is null
$function$;

revoke all on function public.count_unread_notifications() from public;

create or replace function public.list_notifications(
  page_size integer default 30
)
returns table (
  id uuid,
  kind public.notification_kind,
  created_at timestamptz,
  read_at timestamptz,
  group_id uuid,
  group_name text,
  post_id uuid,
  post_excerpt text,
  reply_id uuid,
  reply_body text,
  actor_id uuid,
  actor_name text
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  limited_page_size integer := least(greatest(coalesce(page_size, 30), 1), 50);
begin
  return query
  select
    notification.id,
    notification.kind,
    notification.created_at,
    notification.read_at,
    notification.group_id,
    owning_group.name,
    notification.post_id,
    -- Enough of the post to recognise which one this is about.
    pg_catalog.left(post.body, 80),
    notification.reply_id,
    reply.body,
    notification.actor_id,
    actor.display_name
  from public.notifications as notification
  left join public.groups as owning_group
    on owning_group.id = notification.group_id
  left join public.posts as post on post.id = notification.post_id
  left join public.post_replies as reply on reply.id = notification.reply_id
  left join public.profiles as actor on actor.id = notification.actor_id
  order by notification.created_at desc, notification.id desc
  limit limited_page_size;
end
$function$;

revoke all on function public.list_notifications(integer) from public;

-- The read path, rebuilt around one query.
--
-- The timeline and a single post differ only in how many posts they select and
-- how much of the conversation they carry, so they share a body: two copies of
-- this would drift, and the one that drifted would be the one nobody tested.

create or replace function private.post_image_items(target_post_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'image_path', image.image_path,
        'sort_order', image.sort_order
      )
      order by image.sort_order
    ),
    '[]'::jsonb
  )
  from public.post_images as image
  where image.post_id = target_post_id
$function$;

revoke all on function private.post_image_items(uuid) from public;

create or replace function private.post_oshi_items(target_post_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  -- Built without the timeline's filters, so a filtered timeline still shows
  -- every oshi a post is about.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', oshi.id,
        'name', oshi.name,
        'member_color', oshi.member_color
      )
      order by oshi.sort_order, oshi.name
    ),
    '[]'::jsonb
  )
  from public.post_oshis as association
  join public.oshis as oshi
    on oshi.group_id = association.group_id
    and oshi.id = association.oshi_id
  where association.post_id = target_post_id
$function$;

revoke all on function private.post_oshi_items(uuid) from public;

create or replace function private.post_hashtag_items(target_post_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(hashtag.tag order by hashtag.tag),
    '[]'::jsonb
  )
  from public.post_hashtags as hashtag
  where hashtag.post_id = target_post_id
$function$;

revoke all on function private.post_hashtag_items(uuid) from public;

create or replace function private.post_reply_items(
  target_post_id uuid,
  max_items integer default null
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  -- When the list is capped the newest replies are the ones worth carrying,
  -- but a conversation reads oldest first, so the cap and the order disagree
  -- on purpose. A null cap means the whole thread.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', recent.id,
        'body', recent.body,
        'created_at', recent.created_at,
        'author_id', recent.author_id,
        'author_name', recent.author_name
      )
      order by recent.created_at, recent.id
    ),
    '[]'::jsonb
  )
  from (
    select
      reply.id,
      reply.body,
      reply.created_at,
      reply.author_id,
      author.display_name as author_name
    from public.post_replies as reply
    left join public.profiles as author on author.id = reply.author_id
    where reply.post_id = target_post_id
    order by reply.created_at desc, reply.id desc
    limit max_items
  ) as recent
$function$;

revoke all on function private.post_reply_items(uuid, integer) from public;

create or replace function private.post_share_items(
  target_post_id uuid,
  max_items integer default null
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', recent.id,
        'note', recent.note,
        'created_at', recent.created_at,
        'sharer_id', recent.shared_by,
        'sharer_name', recent.sharer_name
      )
      order by recent.created_at desc, recent.id desc
    ),
    '[]'::jsonb
  )
  from (
    select
      share.id,
      share.note,
      share.created_at,
      share.shared_by,
      sharer.display_name as sharer_name
    from public.post_shares as share
    left join public.profiles as sharer on sharer.id = share.shared_by
    where share.post_id = target_post_id
    order by share.created_at desc, share.id desc
    limit max_items
  ) as recent
$function$;

revoke all on function private.post_share_items(uuid, integer) from public;

create or replace function private.post_timeline_rows(
  target_group_id uuid,
  target_post_id uuid,
  filter_oshi_id uuid,
  filter_tag text,
  before_created_at timestamptz,
  before_id uuid,
  page_size integer,
  embed_limit integer
)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  author_id uuid,
  author_name text,
  images jsonb,
  oshis jsonb,
  hashtags jsonb,
  replies jsonb,
  reply_count bigint,
  shares jsonb,
  share_count bigint,
  shared_by_viewer boolean,
  like_count bigint,
  liked_by_viewer boolean
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  viewer_id uuid := private.current_user_id();
  normalized_tag text := nullif(pg_catalog.btrim(filter_tag), '');
begin
  return query
  select
    post.id,
    post.body,
    post.created_at,
    post.updated_at,
    post.author_id,
    -- Left joined: a profile the reader cannot see must cost the post its
    -- byline, never its place in the timeline.
    author.display_name,
    private.post_image_items(post.id),
    private.post_oshi_items(post.id),
    private.post_hashtag_items(post.id),
    private.post_reply_items(post.id, embed_limit),
    (
      select pg_catalog.count(*)
      from public.post_replies as reply
      where reply.post_id = post.id
    ),
    private.post_share_items(post.id, embed_limit),
    (
      select pg_catalog.count(*)
      from public.post_shares as share
      where share.post_id = post.id
    ),
    exists (
      select 1
      from public.post_shares as share
      where share.post_id = post.id
        and share.shared_by = viewer_id
    ),
    (
      select pg_catalog.count(*)
      from public.post_likes as entry
      where entry.post_id = post.id
    ),
    exists (
      select 1
      from public.post_likes as entry
      where entry.post_id = post.id
        and entry.user_id = viewer_id
    )
  from public.posts as post
  left join public.profiles as author on author.id = post.author_id
  where (target_group_id is null or post.group_id = target_group_id)
    and (target_post_id is null or post.id = target_post_id)
    and (
      filter_oshi_id is null
      or exists (
        select 1
        from public.post_oshis as filtered
        where filtered.post_id = post.id
          and filtered.oshi_id = filter_oshi_id
      )
    )
    and (
      normalized_tag is null
      or exists (
        select 1
        from public.post_hashtags as filtered
        where filtered.post_id = post.id
          and pg_catalog.lower(filtered.tag) = pg_catalog.lower(normalized_tag)
      )
    )
    -- Both halves of the cursor are required: a timestamp alone would drop
    -- posts written inside the same clock tick.
    and (
      before_created_at is null
      or before_id is null
      or (post.created_at, post.id) < (before_created_at, before_id)
    )
  order by post.created_at desc, post.id desc
  limit page_size;
end
$function$;

revoke all on function private.post_timeline_rows(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  integer,
  integer
) from public;

-- The timeline now reports reactions as well, which changes its result type,
-- and a returns table signature can only be changed by replacing it.
drop function if exists public.list_group_posts(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  integer
);

create or replace function public.list_group_posts(
  target_group_id uuid,
  filter_oshi_id uuid default null,
  filter_tag text default null,
  before_created_at timestamptz default null,
  before_id uuid default null,
  page_size integer default 20
)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  author_id uuid,
  author_name text,
  images jsonb,
  oshis jsonb,
  hashtags jsonb,
  replies jsonb,
  reply_count bigint,
  shares jsonb,
  share_count bigint,
  shared_by_viewer boolean,
  like_count bigint,
  liked_by_viewer boolean
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  -- Clamped rather than trusted: the page size arrives from a query string.
  limited_page_size integer := least(greatest(coalesce(page_size, 20), 1), 50);
begin
  return query
  select *
  from private.post_timeline_rows(
    target_group_id,
    null,
    filter_oshi_id,
    filter_tag,
    before_created_at,
    before_id,
    limited_page_size,
    -- Enough of the conversation to read the room; the post's own page has
    -- the rest.
    3
  );
end
$function$;

revoke all on function public.list_group_posts(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  integer
) from public;

create or replace function public.get_group_post(
  target_post_id uuid,
  target_group_id uuid
)
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  author_id uuid,
  author_name text,
  images jsonb,
  oshis jsonb,
  hashtags jsonb,
  replies jsonb,
  reply_count bigint,
  shares jsonb,
  share_count bigint,
  shared_by_viewer boolean,
  like_count bigint,
  liked_by_viewer boolean
)
language sql
stable
set search_path = ''
as $function$
  -- Security invoker like the timeline: a post in another circle is not
  -- refused, it simply is not there, so no answer confirms which ids exist.
  -- The circle is named as well as the post, so a link that pairs a post with
  -- the wrong circle finds nothing instead of answering under it.
  select *
  from private.post_timeline_rows(
    target_group_id,
    target_post_id,
    null,
    null,
    null,
    null,
    1,
    null
  )
$function$;

revoke all on function public.get_group_post(uuid, uuid) from public;

revoke all on table public.post_likes from public, anon, authenticated;
revoke all on table public.post_replies from public, anon, authenticated;
revoke all on table public.post_shares from public, anon, authenticated;
revoke all on table public.notifications from public, anon, authenticated;

grant select on public.post_likes to authenticated;
grant select on public.post_replies to authenticated;
grant select on public.post_shares to authenticated;
grant select on public.notifications to authenticated;

grant all on public.post_likes to service_role;
grant all on public.post_replies to service_role;
grant all on public.post_shares to service_role;
grant all on public.notifications to service_role;

grant execute on function private.current_user_id() to authenticated;
grant execute on function private.can_remove_reply(uuid) to authenticated;
grant execute on function private.post_image_items(uuid) to authenticated;
grant execute on function private.post_oshi_items(uuid) to authenticated;
grant execute on function private.post_hashtag_items(uuid) to authenticated;
grant execute on function private.post_reply_items(uuid, integer)
  to authenticated;
grant execute on function private.post_share_items(uuid, integer)
  to authenticated;
grant execute on function private.post_timeline_rows(
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  integer,
  integer
) to authenticated;

grant execute on function public.toggle_post_like(uuid) to authenticated;
grant execute on function public.create_reply(uuid, text) to authenticated;
grant execute on function public.delete_reply(uuid) to authenticated;
grant execute on function public.share_post(uuid, uuid, text) to authenticated;
grant execute on function public.unshare_post(uuid) to authenticated;
grant execute on function public.mark_notifications_read(uuid[])
  to authenticated;
grant execute on function public.count_unread_notifications() to authenticated;
grant execute on function public.list_notifications(integer) to authenticated;
grant execute on function public.list_group_posts(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  integer
) to authenticated;
grant execute on function public.get_group_post(uuid, uuid) to authenticated;

commit;
