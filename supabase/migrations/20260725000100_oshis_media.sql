begin;

create or replace function private.has_unsafe_display_characters(
  candidate text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  -- C0 and C1 controls, plus the zero-width and bidirectional overrides that
  -- let one display name impersonate another. U+200D is left alone so emoji
  -- joiner sequences keep working.
  select coalesce(
    exists (
      select 1
      from pg_catalog.regexp_split_to_table(candidate, '') as symbol
      where pg_catalog.ascii(symbol) between 0 and 31
        or pg_catalog.ascii(symbol) between 127 and 159
        or pg_catalog.ascii(symbol) in (8203, 8204, 8206, 8207, 65279)
        or pg_catalog.ascii(symbol) between 8234 and 8238
        or pg_catalog.ascii(symbol) between 8294 and 8297
    ),
    false
  )
$function$;

revoke all on function private.has_unsafe_display_characters(text) from public;

-- Phase 3: multiple oshis per group, ordering, member colours, and the
-- private image bucket that backs them.
--
-- Every row carries group_id and exposes UNIQUE (group_id, id) so later
-- phases can hang posts and media off an oshi with a composite foreign key
-- that cannot cross a group boundary.

create table public.oshis (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null
    check (
      pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 40
      and not private.has_unsafe_display_characters(name)
    ),
  member_color text not null
    check (member_color ~ '^#[0-9a-f]{6}$'),
  sort_order integer not null check (sort_order >= 0),
  image_path text
    check (
      image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}[.](jpg|png|webp)$'
    ),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (group_id, id),
  unique (image_path),
  -- An object may only be claimed by the very row it is stored under, so a
  -- member cannot point their oshi at another group's file.
  check (
    image_path is null
    or pg_catalog.starts_with(
      image_path,
      group_id::text || '/' || id::text || '/'
    )
  )
);

-- Reordering rewrites many rows in one statement, so the ordering key has to
-- be deferrable: transient duplicates are legal until the transaction commits.
alter table public.oshis
  add constraint oshis_group_sort_order_key
  unique (group_id, sort_order) deferrable initially deferred;

create unique index oshis_group_name_idx
  on public.oshis (
    group_id,
    pg_catalog.lower(pg_catalog.btrim(name))
  );

create index oshis_group_created_by_idx
  on public.oshis (group_id, created_by);

create or replace function private.oshi_image_group_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $function$
  select case
    when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}[.](jpg|png|webp)$'
      then (pg_catalog.split_part(object_name, '/', 1))::uuid
  end
$function$;

revoke all on function private.oshi_image_group_id(text) from public;

create or replace function private.oshi_image_oshi_id(object_name text)
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

revoke all on function private.oshi_image_oshi_id(text) from public;

create or replace function private.can_manage_oshi(target_oshi_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    exists (
      select 1
      from public.oshis as oshi
      where oshi.id = target_oshi_id
        -- Creating an oshi is not a permanent claim: losing membership must
        -- also lose every write path to it.
        and private.is_group_member(oshi.group_id)
        and (
          oshi.created_by = (select auth.uid())
          or private.has_group_role(
            oshi.group_id,
            array['owner', 'admin']::public.membership_role[]
          )
        )
    ),
    false
  )
$function$;

revoke all on function private.can_manage_oshi(uuid) from public;

alter table public.oshis enable row level security;
alter table public.oshis force row level security;

create policy oshis_select_members
  on public.oshis
  for select
  to authenticated
  using (private.is_group_member(group_id));

create or replace function public.create_oshi(
  target_group_id uuid,
  oshi_name text,
  oshi_color text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(oshi_name);
  normalized_color text := pg_catalog.lower(pg_catalog.btrim(oshi_color));
  existing_oshi_count bigint;
  next_sort_order integer;
  created_oshi_id uuid;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if normalized_name is null
    or pg_catalog.char_length(normalized_name) not between 1 and 40
    or private.has_unsafe_display_characters(normalized_name)
  then
    raise exception using
      errcode = '22023',
      message = 'Oshi name must contain 1 to 40 printable characters';
  end if;

  if normalized_color is null or normalized_color !~ '^#[0-9a-f]{6}$' then
    raise exception using
      errcode = '22023',
      message = 'Member colour must be a #rrggbb value';
  end if;

  -- Lock the group before authorizing so a concurrent membership change
  -- cannot slip between the check and the insert.
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
  into existing_oshi_count
  from public.oshis as oshi
  where oshi.group_id = target_group_id;

  if existing_oshi_count >= 50 then
    raise exception using
      errcode = '22023',
      message = 'Oshi quota exceeded';
  end if;

  select coalesce(pg_catalog.max(oshi.sort_order) + 1, 0)
  into next_sort_order
  from public.oshis as oshi
  where oshi.group_id = target_group_id;

  insert into public.oshis (
    group_id,
    name,
    member_color,
    sort_order,
    created_by
  )
  values (
    target_group_id,
    normalized_name,
    normalized_color,
    next_sort_order,
    actor_id
  )
  returning id into created_oshi_id;

  return created_oshi_id;
end
$function$;

revoke all on function public.create_oshi(uuid, text, text) from public;

create or replace function public.update_oshi(
  target_oshi_id uuid,
  oshi_name text,
  oshi_color text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(oshi_name);
  normalized_color text := pg_catalog.lower(pg_catalog.btrim(oshi_color));
  owning_group_id uuid;
  updated_oshi_id uuid;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if normalized_name is null
    or pg_catalog.char_length(normalized_name) not between 1 and 40
    or private.has_unsafe_display_characters(normalized_name)
  then
    raise exception using
      errcode = '22023',
      message = 'Oshi name must contain 1 to 40 printable characters';
  end if;

  if normalized_color is null or normalized_color !~ '^#[0-9a-f]{6}$' then
    raise exception using
      errcode = '22023',
      message = 'Member colour must be a #rrggbb value';
  end if;

  -- A missing oshi and a forbidden oshi return the same answer, so the RPC
  -- cannot be used to probe which ids exist in other groups.
  select oshi.group_id
  into owning_group_id
  from public.oshis as oshi
  where oshi.id = target_oshi_id;

  if owning_group_id is null or not private.can_manage_oshi(target_oshi_id) then
    return false;
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_manage_oshi(target_oshi_id) then
    return false;
  end if;

  update public.oshis as oshi
  set
    name = normalized_name,
    member_color = normalized_color,
    updated_at = pg_catalog.statement_timestamp()
  where oshi.id = target_oshi_id
  returning oshi.id into updated_oshi_id;

  return updated_oshi_id is not null;
end
$function$;

revoke all on function public.update_oshi(uuid, text, text) from public;

create or replace function public.reorder_oshis(
  target_group_id uuid,
  ordered_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  supplied_count integer;
  distinct_supplied_count bigint;
  group_oshi_count bigint;
  matched_oshi_count bigint;
  reordered_count integer;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  supplied_count := coalesce(pg_catalog.array_length(ordered_ids, 1), 0);

  if supplied_count < 1 or supplied_count > 50 then
    raise exception using
      errcode = '22023',
      message = 'Ordered id list must contain 1 to 50 entries';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = target_group_id
  for update;

  if not found or not private.has_group_role(
    target_group_id,
    array['owner', 'admin']::public.membership_role[]
  ) then
    raise exception using
      errcode = '42501',
      message = 'Group manager role required';
  end if;

  select pg_catalog.count(distinct entry.id)
  into distinct_supplied_count
  from pg_catalog.unnest(ordered_ids) as entry(id);

  select pg_catalog.count(*)
  into group_oshi_count
  from public.oshis as oshi
  where oshi.group_id = target_group_id;

  select pg_catalog.count(*)
  into matched_oshi_count
  from public.oshis as oshi
  where oshi.group_id = target_group_id
    and oshi.id = any (ordered_ids);

  if distinct_supplied_count <> supplied_count
    or matched_oshi_count <> supplied_count
    or matched_oshi_count <> group_oshi_count
  then
    raise exception using
      errcode = '22023',
      message = 'Reorder requires a complete permutation of the group oshis';
  end if;

  with ordering as (
    select
      entry.id as oshi_id,
      (entry.position - 1)::integer as sort_order
    from pg_catalog.unnest(ordered_ids) with ordinality as entry(id, position)
  )
  update public.oshis as oshi
  set
    sort_order = ordering.sort_order,
    updated_at = pg_catalog.statement_timestamp()
  from ordering
  where oshi.id = ordering.oshi_id
    and oshi.group_id = target_group_id
    and oshi.sort_order is distinct from ordering.sort_order;

  get diagnostics reordered_count = row_count;

  return reordered_count;
end
$function$;

revoke all on function public.reorder_oshis(uuid, uuid[]) from public;

create or replace function public.set_oshi_image(
  target_oshi_id uuid,
  new_image_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  owning_group_id uuid;
  previous_image_path text;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select oshi.group_id
  into owning_group_id
  from public.oshis as oshi
  where oshi.id = target_oshi_id;

  if owning_group_id is null or not private.can_manage_oshi(target_oshi_id) then
    raise exception using
      errcode = '42501',
      message = 'Oshi management permission required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_manage_oshi(target_oshi_id) then
    raise exception using
      errcode = '42501',
      message = 'Oshi management permission required';
  end if;

  if new_image_path is not null
    and not pg_catalog.starts_with(
      new_image_path,
      owning_group_id::text || '/' || target_oshi_id::text || '/'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Image path must live under the owning group and oshi';
  end if;

  select oshi.image_path
  into previous_image_path
  from public.oshis as oshi
  where oshi.id = target_oshi_id
  for update;

  update public.oshis as oshi
  set
    image_path = new_image_path,
    updated_at = pg_catalog.statement_timestamp()
  where oshi.id = target_oshi_id;

  if previous_image_path is not distinct from new_image_path then
    return null;
  end if;

  -- The caller removes the replaced object; nothing else references it.
  return previous_image_path;
end
$function$;

revoke all on function public.set_oshi_image(uuid, text) from public;

create or replace function public.delete_oshi(target_oshi_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  owning_group_id uuid;
  deleted_image_path text;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select oshi.group_id
  into owning_group_id
  from public.oshis as oshi
  where oshi.id = target_oshi_id;

  if owning_group_id is null or not private.can_manage_oshi(target_oshi_id) then
    raise exception using
      errcode = '42501',
      message = 'Oshi management permission required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.can_manage_oshi(target_oshi_id) then
    raise exception using
      errcode = '42501',
      message = 'Oshi management permission required';
  end if;

  delete from public.oshis as oshi
  where oshi.id = target_oshi_id
  returning oshi.image_path into deleted_image_path;

  return deleted_image_path;
end
$function$;

revoke all on function public.delete_oshi(uuid) from public;

revoke all on table public.oshis from public, anon, authenticated;
grant select on public.oshis to authenticated;
grant all on public.oshis to service_role;

grant execute on function private.has_unsafe_display_characters(text)
  to authenticated;
grant execute on function private.oshi_image_group_id(text)
  to authenticated;
grant execute on function private.oshi_image_oshi_id(text)
  to authenticated;
grant execute on function private.can_manage_oshi(uuid)
  to authenticated;

grant execute on function public.create_oshi(uuid, text, text)
  to authenticated;
grant execute on function public.update_oshi(uuid, text, text)
  to authenticated;
grant execute on function public.reorder_oshis(uuid, uuid[])
  to authenticated;
grant execute on function public.set_oshi_image(uuid, text)
  to authenticated;
grant execute on function public.delete_oshi(uuid)
  to authenticated;

-- Private bucket. The mime allow list mirrors lib/media/image-signature.ts and
-- is deliberately raster only: SVG is a scriptable document, not an image.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'oshi-images',
  'oshi-images',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Hosted Supabase ships storage.objects with row level security already on.
-- Enable it defensively so a self-hosted or freshly restored database cannot
-- serve objects without the policies below.
do $storage_rls$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relrowsecurity
  ) then
    execute 'alter table storage.objects enable row level security';
  end if;
end
$storage_rls$;

create policy oshi_images_select_members
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'oshi-images'
    and private.is_group_member(private.oshi_image_group_id(name))
  );

-- The object name has to point at an oshi row the caller may manage, so the
-- bucket cannot be used to park files that no row will ever reference.
create policy oshi_images_insert_members
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'oshi-images'
    and private.is_group_member(private.oshi_image_group_id(name))
    and private.can_manage_oshi(private.oshi_image_oshi_id(name))
  );

-- No UPDATE policy: objects are immutable. Replacing an image always writes a
-- new random object name, so a stale signed URL can never resolve to a
-- different member's photo.
create policy oshi_images_delete_managers
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'oshi-images'
    and private.has_group_role(
      private.oshi_image_group_id(name),
      array['owner', 'admin']::public.membership_role[]
    )
  );

commit;
