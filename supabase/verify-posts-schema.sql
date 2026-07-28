-- Run this against the hosted project after applying the phase 4 migrations.
--
-- It reads nothing and writes nothing: it only asserts that the objects the
-- timeline depends on actually landed, including the privileges, because a
-- migration that half applied looks exactly like one that worked until a
-- member presses a button.
--
-- It raises on the first thing that is missing, and says PASS at the end.

do $verify$
declare
  missing text;
  expected_functions text[] := array[
    'create_post',
    'update_post',
    'delete_post',
    'attach_post_image',
    'detach_post_image',
    'list_group_posts'
  ];
  expected_tables text[] := array[
    'posts',
    'post_images',
    'post_oshis',
    'post_hashtags'
  ];
  expected_storage_policies text[] := array[
    'post_images_storage_select_members',
    'post_images_storage_insert_authors',
    'post_images_storage_delete_managers'
  ];
  bucket record;
begin
  -- tables, with row level security both enabled and forced
  foreach missing in array expected_tables loop
    if not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = missing
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) then
      raise exception
        'public.% is missing, or its row level security is not forced',
        missing;
    end if;
  end loop;

  -- the write path: every mutation goes through a function, never through
  -- direct DML, so the table grants have to stay revoked
  foreach missing in array expected_tables loop
    if pg_catalog.has_table_privilege(
      'authenticated',
      'public.' || missing,
      'INSERT'
    ) then
      raise exception
        'authenticated can still insert into public.% directly',
        missing;
    end if;

    if not pg_catalog.has_table_privilege(
      'authenticated',
      'public.' || missing,
      'SELECT'
    ) then
      raise exception 'authenticated cannot read public.%', missing;
    end if;
  end loop;

  -- the functions, and the grant that lets a signed in member call them
  foreach missing in array expected_functions loop
    if not exists (
      select 1
      from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = routine.pronamespace
      where namespace.nspname = 'public'
        and routine.proname = missing
        and pg_catalog.has_function_privilege(
          'authenticated',
          routine.oid,
          'EXECUTE'
        )
    ) then
      raise exception
        'public.% is missing, or authenticated may not execute it',
        missing;
    end if;
  end loop;

  -- attach_post_image has to be the slot reusing version, otherwise removing
  -- a photo silently costs the post one of its four slots
  if not exists (
    select 1
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname = 'attach_post_image'
      and pg_catalog.pg_get_functiondef(routine.oid) like '%generate_series(1, 4)%'
  ) then
    raise exception
      'attach_post_image is the older append only version: apply 20260728000100';
  end if;

  -- the bucket, private and capped exactly as the migration declares it
  select * into bucket from storage.buckets where id = 'post-images';

  if not found then
    raise exception 'the post-images bucket is missing';
  end if;

  if bucket.public then
    raise exception 'the post-images bucket is public';
  end if;

  if bucket.file_size_limit is distinct from 1048576 then
    raise exception
      'the post-images size limit is % rather than 1 MiB',
      bucket.file_size_limit;
  end if;

  if not (
    bucket.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']
    and pg_catalog.array_length(bucket.allowed_mime_types, 1) = 3
  ) then
    raise exception
      'the post-images mime allow list is %',
      bucket.allowed_mime_types;
  end if;

  -- the storage policies that keep one group out of another group's photos
  foreach missing in array expected_storage_policies loop
    if not exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'storage'
        and policy.tablename = 'objects'
        and policy.policyname = missing
    ) then
      raise exception 'the storage policy % is missing', missing;
    end if;
  end loop;

  raise notice 'phase 4 schema verification: PASS';
end
$verify$;
