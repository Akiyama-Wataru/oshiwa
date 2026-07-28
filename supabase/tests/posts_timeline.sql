\set ON_ERROR_STOP on

-- Invariants for the timeline read path: what a member sees, in what order,
-- how a page continues, and what the filters may not quietly change.

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '40000000-0000-0000-0000-000000000001',
    'timeline-author@example.com',
    pg_catalog.now(),
    '{"display_name":"Author"}'::jsonb
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    'timeline-member@example.com',
    pg_catalog.now(),
    '{"display_name":"Member"}'::jsonb
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    'timeline-outsider@example.com',
    pg_catalog.now(),
    '{"display_name":"Outsider"}'::jsonb
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000001',
  true
);

select public.create_group('Timeline Read') as group_id \gset
select public.create_oshi(:'group_id'::uuid, 'ミナ', '#ff6f91') as oshi_one \gset
select public.create_oshi(:'group_id'::uuid, 'サナ', '#59a5f5') as oshi_two \gset

reset role;

insert into public.memberships (group_id, user_id, role)
values (
  :'group_id'::uuid,
  '40000000-0000-0000-0000-000000000002',
  'member'
);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000001',
  true
);

select public.create_post(
  :'group_id'::uuid,
  '一曲目がよかった',
  array[:'oshi_one'::uuid],
  array['LIVE', '尊い']
) as post_one \gset

select public.create_post(
  :'group_id'::uuid,
  '二人とも見えた',
  array[:'oshi_one'::uuid, :'oshi_two'::uuid],
  array['live']
) as post_two \gset

select public.create_post(:'group_id'::uuid, '写真だけ') as post_three \gset

select public.attach_post_image(
  :'post_three'::uuid,
  :'group_id' || '/' || :'post_three' || '/' || pg_catalog.repeat('a', 32) || '.webp'
);
select public.attach_post_image(
  :'post_three'::uuid,
  :'group_id' || '/' || :'post_three' || '/' || pg_catalog.repeat('b', 32) || '.webp'
);

reset role;

-- Every row in one transaction shares now(), so the timestamps are spread by
-- hand: without that the ordering assertion would only prove the tie breaker.
update public.posts
set created_at = timestamptz '2026-07-27 09:00:00+00'
where id = :'post_one'::uuid;
update public.posts
set created_at = timestamptz '2026-07-27 10:00:00+00'
where id = :'post_two'::uuid;
update public.posts
set created_at = timestamptz '2026-07-27 11:00:00+00'
where id = :'post_three'::uuid;

select pg_catalog.set_config('test.group_id', :'group_id', true);
select pg_catalog.set_config('test.oshi_one', :'oshi_one', true);
select pg_catalog.set_config('test.oshi_two', :'oshi_two', true);
select pg_catalog.set_config('test.post_one', :'post_one', true);
select pg_catalog.set_config('test.post_two', :'post_two', true);
select pg_catalog.set_config('test.post_three', :'post_three', true);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000002',
  true
);

-- newest first, with the author and every association carried alongside.
do $assert$
declare
  entry record;
  page record;
begin
  select
    pg_catalog.array_agg(numbered.id order by numbered.position) as ids,
    pg_catalog.count(*) as total
  into page
  from (
    select row_number() over () as position, listed.id
    from public.list_group_posts(
      pg_catalog.current_setting('test.group_id')::uuid
    ) as listed
  ) as numbered;

  if page.total <> 3 then
    raise exception 'the timeline returned % posts instead of 3', page.total;
  end if;

  if page.ids <> array[
    pg_catalog.current_setting('test.post_three')::uuid,
    pg_catalog.current_setting('test.post_two')::uuid,
    pg_catalog.current_setting('test.post_one')::uuid
  ] then
    raise exception 'the timeline was not ordered newest first';
  end if;

  select * into entry
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_id')::uuid
  ) as listed
  where listed.id = pg_catalog.current_setting('test.post_one')::uuid;

  if entry.author_name <> 'Author' then
    raise exception 'the author was reported as %', entry.author_name;
  end if;

  if pg_catalog.jsonb_array_length(entry.hashtags) <> 2 then
    raise exception 'the hashtags were not carried with the post';
  end if;

  if pg_catalog.jsonb_array_length(entry.oshis) <> 1
    or entry.oshis -> 0 ->> 'name' <> 'ミナ'
    or entry.oshis -> 0 ->> 'member_color' <> '#ff6f91'
  then
    raise exception 'the oshi association was not carried with the post';
  end if;

  if entry.images <> '[]'::jsonb then
    raise exception 'a post without images did not report an empty list';
  end if;

  select * into entry
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_id')::uuid
  ) as listed
  where listed.id = pg_catalog.current_setting('test.post_three')::uuid;

  if pg_catalog.jsonb_array_length(entry.images) <> 2
    or (entry.images -> 0 ->> 'sort_order')::integer <> 1
    or (entry.images -> 1 ->> 'sort_order')::integer <> 2
    or entry.images -> 0 ->> 'image_path' not like '%' || pg_catalog.repeat('a', 32) || '.webp'
  then
    raise exception 'the images were not carried in slot order';
  end if;

  if entry.oshis <> '[]'::jsonb or entry.hashtags <> '[]'::jsonb then
    raise exception 'missing associations were reported as null instead of []';
  end if;
end
$assert$;

-- keyset paging: the cursor is the (created_at, id) pair of the last row read,
-- and the next page neither repeats nor skips a post.
do $assert$
declare
  cursor_created_at timestamptz;
  cursor_id uuid;
  first_page uuid[];
  second_page uuid[];
begin
  select
    pg_catalog.array_agg(numbered.id order by numbered.position)
  into first_page
  from (
    select row_number() over () as position, listed.id
    from public.list_group_posts(
      pg_catalog.current_setting('test.group_id')::uuid,
      null::uuid,
      null::text,
      null::timestamptz,
      null::uuid,
      2
    ) as listed
  ) as numbered;

  if first_page <> array[
    pg_catalog.current_setting('test.post_three')::uuid,
    pg_catalog.current_setting('test.post_two')::uuid
  ] then
    raise exception 'the first page was not the two newest posts';
  end if;

  select listed.created_at, listed.id
  into cursor_created_at, cursor_id
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_id')::uuid
  ) as listed
  where listed.id = pg_catalog.current_setting('test.post_two')::uuid;

  select pg_catalog.array_agg(listed.id)
  into second_page
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_id')::uuid,
    null::uuid,
    null::text,
    cursor_created_at,
    cursor_id,
    2
  ) as listed;

  if second_page <> array[
    pg_catalog.current_setting('test.post_one')::uuid
  ] then
    raise exception 'the page after the cursor was not the remaining post';
  end if;

  -- A page size outside the supported range is clamped rather than obeyed.
  if (
    select pg_catalog.count(*)
    from public.list_group_posts(
      pg_catalog.current_setting('test.group_id')::uuid,
      null::uuid,
      null::text,
      null::timestamptz,
      null::uuid,
      0
    )
  ) <> 1 then
    raise exception 'a page size of zero was not clamped to one row';
  end if;
end
$assert$;

-- filters narrow which posts are listed, never which associations a listed
-- post carries.
do $assert$
declare
  entry record;
  matched uuid[];
begin
  select pg_catalog.array_agg(listed.id)
  into matched
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_id')::uuid,
    pg_catalog.current_setting('test.oshi_two')::uuid
  ) as listed;

  if matched <> array[pg_catalog.current_setting('test.post_two')::uuid] then
    raise exception 'the oshi filter did not narrow to the tagged post';
  end if;

  select * into entry
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_id')::uuid,
    pg_catalog.current_setting('test.oshi_two')::uuid
  ) as listed;

  if pg_catalog.jsonb_array_length(entry.oshis) <> 2 then
    raise exception 'the oshi filter pruned the association list to %',
      entry.oshis;
  end if;

  select pg_catalog.array_agg(listed.id order by listed.created_at)
  into matched
  from public.list_group_posts(
    pg_catalog.current_setting('test.group_id')::uuid,
    null::uuid,
    'live'
  ) as listed;

  if matched <> array[
    pg_catalog.current_setting('test.post_one')::uuid,
    pg_catalog.current_setting('test.post_two')::uuid
  ] then
    raise exception 'the hashtag filter was case sensitive';
  end if;

  if (
    select pg_catalog.count(*)
    from public.list_group_posts(
      pg_catalog.current_setting('test.group_id')::uuid,
      null::uuid,
      '   '
    )
  ) <> 3 then
    raise exception 'a blank hashtag filter narrowed the timeline';
  end if;
end
$assert$;

-- a member may not strip the images off a post they did not write.
do $assert$
begin
  begin
    perform public.detach_post_image(
      pg_catalog.current_setting('test.post_three')::uuid,
      pg_catalog.current_setting('test.group_id')
        || '/'
        || pg_catalog.current_setting('test.post_three')
        || '/'
        || pg_catalog.repeat('a', 32)
        || '.webp'
    );
    raise exception 'a member detached an image from another member post';
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
  '40000000-0000-0000-0000-000000000003',
  true
);

-- an outsider reads an empty timeline rather than an error that confirms the
-- group exists.
do $assert$
begin
  if (
    select pg_catalog.count(*)
    from public.list_group_posts(
      pg_catalog.current_setting('test.group_id')::uuid
    )
  ) <> 0 then
    raise exception 'an outsider read another group timeline';
  end if;
end
$assert$;

reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '40000000-0000-0000-0000-000000000001',
  true
);

-- the author frees a slot and the next upload reuses it, so removing an image
-- can never cost the post its fourth slot.
do $assert$
declare
  prefix text :=
    pg_catalog.current_setting('test.group_id')
    || '/'
    || pg_catalog.current_setting('test.post_three')
    || '/';
  detached text;
  reused smallint;
begin
  detached := public.detach_post_image(
    pg_catalog.current_setting('test.post_three')::uuid,
    prefix || pg_catalog.repeat('a', 32) || '.webp'
  );

  if detached <> prefix || pg_catalog.repeat('a', 32) || '.webp' then
    raise exception 'detaching returned % instead of the orphaned path',
      detached;
  end if;

  if exists (
    select 1
    from public.post_images as image
    where image.image_path = detached
  ) then
    raise exception 'the detached image row survived';
  end if;

  reused := public.attach_post_image(
    pg_catalog.current_setting('test.post_three')::uuid,
    prefix || pg_catalog.repeat('c', 32) || '.webp'
  );

  if reused <> 1 then
    raise exception 'the freed slot was not reused: landed in %', reused;
  end if;

  begin
    perform public.detach_post_image(
      pg_catalog.current_setting('test.post_three')::uuid,
      prefix || pg_catalog.repeat('f', 32) || '.webp'
    );
    raise exception 'detaching an unknown path was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

reset role;

rollback;
