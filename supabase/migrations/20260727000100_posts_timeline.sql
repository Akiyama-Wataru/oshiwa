begin;

-- Phase 4: posts, their images, and the oshi and hashtag associations that the
-- timeline filters on.
--
-- Every child table carries group_id and joins its parent through
-- (group_id, id) rather than id alone. A post can therefore never reference an
-- oshi from another group: the foreign key itself makes it unrepresentable,
-- instead of leaving it to a check the application might forget.

create or replace function private.has_unsafe_body_characters(candidate text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  -- Same rule as private.has_unsafe_display_characters, except that tab and
  -- line feed are part of written text rather than an attack.
  select coalesce(
    exists (
      select 1
      from pg_catalog.regexp_split_to_table(candidate, '') as symbol
      where pg_catalog.ascii(symbol) between 0 and 8
        or pg_catalog.ascii(symbol) between 11 and 31
        or pg_catalog.ascii(symbol) between 127 and 159
        or pg_catalog.ascii(symbol) in (8203, 8204, 8206, 8207, 65279)
        or pg_catalog.ascii(symbol) between 8234 and 8238
        or pg_catalog.ascii(symbol) between 8294 and 8297
    ),
    false
  )
$function$;

revoke all on function private.has_unsafe_body_characters(text) from public;

create table public.posts (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null
    check (
      pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 2000
      and not private.has_unsafe_body_characters(body)
    ),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (group_id, id)
);

-- The timeline reads one group newest first and pages with a keyset, so the
-- index carries the tie breaker the cursor uses.
create index posts_group_timeline_idx
  on public.posts (group_id, created_at desc, id desc);

create index posts_group_author_idx on public.posts (group_id, author_id);

create table public.post_images (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null,
  post_id uuid not null,
  sort_order smallint not null check (sort_order between 1 and 4),
  image_path text not null
    check (
      image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}[.](jpg|png|webp)$'
    ),
  created_at timestamptz not null default pg_catalog.now(),
  unique (post_id, sort_order),
  unique (image_path),
  foreign key (group_id, post_id)
    references public.posts (group_id, id) on delete cascade,
  check (
    pg_catalog.starts_with(
      image_path,
      group_id::text || '/' || post_id::text || '/'
    )
  )
);

create index post_images_post_idx on public.post_images (post_id, sort_order);

create table public.post_oshis (
  group_id uuid not null,
  post_id uuid not null,
  oshi_id uuid not null,
  primary key (post_id, oshi_id),
  foreign key (group_id, post_id)
    references public.posts (group_id, id) on delete cascade,
  foreign key (group_id, oshi_id)
    references public.oshis (group_id, id) on delete cascade
);

create index post_oshis_filter_idx on public.post_oshis (group_id, oshi_id);

create table public.post_hashtags (
  group_id uuid not null,
  post_id uuid not null,
  tag text not null
    check (
      pg_catalog.char_length(tag) between 1 and 30
      and tag !~ '[[:space:]#]'
      and not private.has_unsafe_display_characters(tag)
    ),
  primary key (post_id, tag),
  foreign key (group_id, post_id)
    references public.posts (group_id, id) on delete cascade
);

create index post_hashtags_filter_idx
  on public.post_hashtags (group_id, pg_catalog.lower(tag));

create or replace function private.can_edit_post(target_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  -- Only the author rewrites their own words.
  select coalesce(
    exists (
      select 1
      from public.posts as post
      where post.id = target_post_id
        and private.is_group_member(post.group_id)
        and post.author_id = (select auth.uid())
    ),
    false
  )
$function$;

revoke all on function private.can_edit_post(uuid) from public;

create or replace function private.can_remove_post(target_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  -- Deletion is also a moderation action, so managers may remove a post they
  -- did not write. Losing membership loses both rights.
  select coalesce(
    exists (
      select 1
      from public.posts as post
      where post.id = target_post_id
        and private.is_group_member(post.group_id)
        and (
          post.author_id = (select auth.uid())
          or private.has_group_role(
            post.group_id,
            array['owner', 'admin']::public.membership_role[]
          )
        )
    ),
    false
  )
$function$;

revoke all on function private.can_remove_post(uuid) from public;

alter table public.posts enable row level security;
alter table public.posts force row level security;
alter table public.post_images enable row level security;
alter table public.post_images force row level security;
alter table public.post_oshis enable row level security;
alter table public.post_oshis force row level security;
alter table public.post_hashtags enable row level security;
alter table public.post_hashtags force row level security;

create policy posts_select_members
  on public.posts
  for select
  to authenticated
  using (private.is_group_member(group_id));

create policy post_images_select_members
  on public.post_images
  for select
  to authenticated
  using (private.is_group_member(group_id));

create policy post_oshis_select_members
  on public.post_oshis
  for select
  to authenticated
  using (private.is_group_member(group_id));

create policy post_hashtags_select_members
  on public.post_hashtags
  for select
  to authenticated
  using (private.is_group_member(group_id));

create or replace function private.replace_post_associations(
  target_post_id uuid,
  owning_group_id uuid,
  oshi_ids uuid[],
  hashtags text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  distinct_oshi_ids uuid[];
  distinct_hashtags text[];
  matched_oshi_count bigint;
begin
  select coalesce(pg_catalog.array_agg(distinct entry.id), array[]::uuid[])
  into distinct_oshi_ids
  from pg_catalog.unnest(coalesce(oshi_ids, array[]::uuid[])) as entry(id);

  if pg_catalog.array_length(distinct_oshi_ids, 1) > 10 then
    raise exception using
      errcode = '22023',
      message = 'A post may reference at most 10 oshis';
  end if;

  -- The composite foreign key would refuse a foreign oshi anyway; failing here
  -- keeps the error a validation error rather than a constraint violation.
  select pg_catalog.count(*)
  into matched_oshi_count
  from public.oshis as oshi
  where oshi.group_id = owning_group_id
    and oshi.id = any (distinct_oshi_ids);

  if matched_oshi_count
    <> coalesce(pg_catalog.array_length(distinct_oshi_ids, 1), 0)
  then
    raise exception using
      errcode = '22023',
      message = 'Every referenced oshi must belong to the same group';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct pg_catalog.btrim(entry.tag)),
    array[]::text[]
  )
  into distinct_hashtags
  from pg_catalog.unnest(coalesce(hashtags, array[]::text[])) as entry(tag)
  where pg_catalog.btrim(entry.tag) <> '';

  if pg_catalog.array_length(distinct_hashtags, 1) > 10 then
    raise exception using
      errcode = '22023',
      message = 'A post may carry at most 10 hashtags';
  end if;

  delete from public.post_oshis as association
  where association.post_id = target_post_id;

  delete from public.post_hashtags as hashtag
  where hashtag.post_id = target_post_id;

  insert into public.post_oshis (group_id, post_id, oshi_id)
  select owning_group_id, target_post_id, entry.id
  from pg_catalog.unnest(distinct_oshi_ids) as entry(id);

  insert into public.post_hashtags (group_id, post_id, tag)
  select owning_group_id, target_post_id, entry.tag
  from pg_catalog.unnest(distinct_hashtags) as entry(tag);
end
$function$;

revoke all on function private.replace_post_associations(
  uuid,
  uuid,
  uuid[],
  text[]
) from public;

create or replace function public.create_post(
  target_group_id uuid,
  post_body text,
  oshi_ids uuid[] default array[]::uuid[],
  hashtags text[] default array[]::text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_body text := pg_catalog.btrim(post_body);
  recent_post_count bigint;
  created_post_id uuid;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if normalized_body is null
    or pg_catalog.char_length(normalized_body) not between 1 and 2000
    or private.has_unsafe_body_characters(normalized_body)
  then
    raise exception using
      errcode = '22023',
      message = 'Post body must contain 1 to 2000 printable characters';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = target_group_id
  for update;

  if not found or not private.is_group_member(target_group_id) then
    raise exception using
      errcode = '42501',
      message = 'Group membership required';
  end if;

  select pg_catalog.count(*)
  into recent_post_count
  from public.posts as post
  where post.group_id = target_group_id
    and post.author_id = actor_id
    and post.created_at > pg_catalog.statement_timestamp() - interval '1 hour';

  if recent_post_count >= 60 then
    raise exception using
      errcode = '22023',
      message = 'Hourly post quota exceeded';
  end if;

  insert into public.posts (group_id, author_id, body)
  values (target_group_id, actor_id, normalized_body)
  returning id into created_post_id;

  perform private.replace_post_associations(
    created_post_id,
    target_group_id,
    oshi_ids,
    hashtags
  );

  return created_post_id;
end
$function$;

revoke all on function public.create_post(uuid, text, uuid[], text[])
  from public;

create or replace function public.update_post(
  target_post_id uuid,
  post_body text,
  oshi_ids uuid[] default array[]::uuid[],
  hashtags text[] default array[]::text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_body text := pg_catalog.btrim(post_body);
  owning_group_id uuid;
  updated_post_id uuid;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if normalized_body is null
    or pg_catalog.char_length(normalized_body) not between 1 and 2000
    or private.has_unsafe_body_characters(normalized_body)
  then
    raise exception using
      errcode = '22023',
      message = 'Post body must contain 1 to 2000 printable characters';
  end if;

  -- A missing post and a post owned by somebody else answer the same, so this
  -- cannot be used to probe which ids exist in other groups.
  select post.group_id
  into owning_group_id
  from public.posts as post
  where post.id = target_post_id;

  if owning_group_id is null or not private.can_edit_post(target_post_id) then
    return false;
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_edit_post(target_post_id) then
    return false;
  end if;

  update public.posts as post
  set
    body = normalized_body,
    updated_at = pg_catalog.statement_timestamp()
  where post.id = target_post_id
  returning post.id into updated_post_id;

  perform private.replace_post_associations(
    target_post_id,
    owning_group_id,
    oshi_ids,
    hashtags
  );

  return updated_post_id is not null;
end
$function$;

revoke all on function public.update_post(uuid, text, uuid[], text[])
  from public;

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

  select coalesce(pg_catalog.max(image.sort_order) + 1, 1)::smallint
  into next_sort_order
  from public.post_images as image
  where image.post_id = target_post_id;

  if next_sort_order > 4 then
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

revoke all on function public.attach_post_image(uuid, text) from public;

create or replace function public.delete_post(target_post_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  owning_group_id uuid;
  orphaned_paths text[];
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

  if owning_group_id is null or not private.can_remove_post(target_post_id) then
    raise exception using
      errcode = '42501',
      message = 'Post removal permission required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_remove_post(target_post_id) then
    raise exception using
      errcode = '42501',
      message = 'Post removal permission required';
  end if;

  select coalesce(pg_catalog.array_agg(image.image_path), array[]::text[])
  into orphaned_paths
  from public.post_images as image
  where image.post_id = target_post_id;

  delete from public.posts as post
  where post.id = target_post_id;

  -- The caller removes the objects; the rows are already gone by cascade.
  return orphaned_paths;
end
$function$;

revoke all on function public.delete_post(uuid) from public;

revoke all on table public.posts from public, anon, authenticated;
revoke all on table public.post_images from public, anon, authenticated;
revoke all on table public.post_oshis from public, anon, authenticated;
revoke all on table public.post_hashtags from public, anon, authenticated;

grant select on public.posts to authenticated;
grant select on public.post_images to authenticated;
grant select on public.post_oshis to authenticated;
grant select on public.post_hashtags to authenticated;

grant all on public.posts to service_role;
grant all on public.post_images to service_role;
grant all on public.post_oshis to service_role;
grant all on public.post_hashtags to service_role;

grant execute on function private.has_unsafe_body_characters(text)
  to authenticated;
grant execute on function private.can_edit_post(uuid) to authenticated;
grant execute on function private.can_remove_post(uuid) to authenticated;

grant execute on function public.create_post(uuid, text, uuid[], text[])
  to authenticated;
grant execute on function public.update_post(uuid, text, uuid[], text[])
  to authenticated;
grant execute on function public.attach_post_image(uuid, text)
  to authenticated;
grant execute on function public.delete_post(uuid) to authenticated;

-- Post photos live in their own private bucket with the same raster only
-- allow list as the oshi bucket.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'post-images',
  'post-images',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function private.post_image_post_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $function$
  select case
    when private.oshi_image_group_id(object_name) is not null
      then (pg_catalog.split_part(object_name, '/', 2))::uuid
  end
$function$;

revoke all on function private.post_image_post_id(text) from public;

grant execute on function private.post_image_post_id(text) to authenticated;

create policy post_images_storage_select_members
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'post-images'
    and private.is_group_member(private.oshi_image_group_id(name))
  );

-- No UPDATE policy: replacing an image always writes a new random object name.
create policy post_images_storage_insert_authors
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and private.is_group_member(private.oshi_image_group_id(name))
    and private.can_edit_post(private.post_image_post_id(name))
  );

create policy post_images_storage_delete_managers
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and private.has_group_role(
      private.oshi_image_group_id(name),
      array['owner', 'admin']::public.membership_role[]
    )
  );

do $storage_privileges$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'supabase_storage_admin'
  ) then
    return;
  end if;

  execute 'grant execute on function private.post_image_post_id(text)
    to supabase_storage_admin';
  execute 'grant execute on function private.can_edit_post(uuid)
    to supabase_storage_admin';
end
$storage_privileges$;

commit;
