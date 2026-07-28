begin;

-- Phase 4, second half: reading the timeline, and taking an image back off a
-- post.
--
-- The read is a function rather than a set of PostgREST queries so that the
-- filters, the keyset cursor and the association lists are written once, in
-- the one place that can be tested against a real database. It is deliberately
-- a security invoker function: row level security still decides which posts
-- exist for the caller, so a non-member reads an empty timeline instead of an
-- error that would confirm the group.

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
  hashtags jsonb
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  normalized_tag text := nullif(pg_catalog.btrim(filter_tag), '');
  -- Clamped rather than trusted: the page size arrives from a query string.
  limited_page_size integer := least(greatest(coalesce(page_size, 20), 1), 50);
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
    image_list.items,
    oshi_list.items,
    hashtag_list.items
  from public.posts as post
  left join public.profiles as author
    on author.id = post.author_id
  left join lateral (
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'image_path', image.image_path,
          'sort_order', image.sort_order
        )
        order by image.sort_order
      ),
      '[]'::jsonb
    ) as items
    from public.post_images as image
    where image.post_id = post.id
  ) as image_list on true
  left join lateral (
    -- The filters below decide which posts are listed. This list is built
    -- without them so a filtered timeline still shows every oshi on a post.
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
    ) as items
    from public.post_oshis as association
    join public.oshis as oshi
      on oshi.group_id = association.group_id
      and oshi.id = association.oshi_id
    where association.post_id = post.id
  ) as oshi_list on true
  left join lateral (
    select coalesce(
      pg_catalog.jsonb_agg(hashtag.tag order by hashtag.tag),
      '[]'::jsonb
    ) as items
    from public.post_hashtags as hashtag
    where hashtag.post_id = post.id
  ) as hashtag_list on true
  where post.group_id = target_group_id
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
  limit limited_page_size;
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

grant execute on function public.list_group_posts(
  uuid,
  uuid,
  text,
  timestamptz,
  uuid,
  integer
) to authenticated;

-- Replaces the append-only version: with removal in place, taking the max slot
-- and adding one would let a post lose a slot for every image ever detached.
create or replace function public.attach_post_image(
  target_post_id uuid,
  new_image_path text
)
returns smallint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  owning_group_id uuid;
  next_sort_order smallint;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select post.group_id
  into owning_group_id
  from public.posts as post
  where post.id = target_post_id;

  if owning_group_id is null or not private.can_edit_post(target_post_id) then
    raise exception using
      errcode = '42501',
      message = 'Post authorship required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_edit_post(target_post_id) then
    raise exception using
      errcode = '42501',
      message = 'Post authorship required';
  end if;

  if new_image_path is null
    or not pg_catalog.starts_with(
      new_image_path,
      owning_group_id::text || '/' || target_post_id::text || '/'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Image path must live under the owning group and post';
  end if;

  select slot.candidate::smallint
  into next_sort_order
  from pg_catalog.generate_series(1, 4) as slot(candidate)
  where not exists (
    select 1
    from public.post_images as image
    where image.post_id = target_post_id
      and image.sort_order = slot.candidate
  )
  order by slot.candidate
  limit 1;

  if next_sort_order is null then
    raise exception using
      errcode = '22023',
      message = 'A post may carry at most 4 images';
  end if;

  insert into public.post_images (
    group_id,
    post_id,
    sort_order,
    image_path
  )
  values (
    owning_group_id,
    target_post_id,
    next_sort_order,
    new_image_path
  );

  return next_sort_order;
end
$function$;

create or replace function public.detach_post_image(
  target_post_id uuid,
  target_image_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  owning_group_id uuid;
  orphaned_path text;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select post.group_id
  into owning_group_id
  from public.posts as post
  where post.id = target_post_id;

  -- Removing an image rewrites the post, so it follows authorship rather than
  -- the wider permission that lets a manager take a whole post down.
  if owning_group_id is null or not private.can_edit_post(target_post_id) then
    raise exception using
      errcode = '42501',
      message = 'Post authorship required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_edit_post(target_post_id) then
    raise exception using
      errcode = '42501',
      message = 'Post authorship required';
  end if;

  delete from public.post_images as image
  where image.post_id = target_post_id
    and image.image_path = target_image_path
  returning image.image_path into orphaned_path;

  if orphaned_path is null then
    raise exception using
      errcode = '22023',
      message = 'No such image on this post';
  end if;

  -- The caller removes the object; the row is already gone.
  return orphaned_path;
end
$function$;

revoke all on function public.detach_post_image(uuid, text) from public;

grant execute on function public.detach_post_image(uuid, text) to authenticated;

commit;
