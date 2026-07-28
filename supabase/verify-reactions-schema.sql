-- Run this against the hosted project after applying the phase 5 migration.
--
-- It reads nothing and writes nothing: it only asserts that the objects likes,
-- replies, notifications and sharing depend on actually landed, including the
-- privileges, because a migration that half applied looks exactly like one that
-- worked until a member presses a button.
--
-- It raises on the first thing that is missing, and says PASS at the end.

do $verify$
declare
  missing text;
  expected_functions text[] := array[
    'toggle_post_like',
    'create_reply',
    'delete_reply',
    'share_post',
    'unshare_post',
    'mark_notifications_read',
    'count_unread_notifications',
    'list_notifications',
    'get_group_post',
    'list_group_posts'
  ];
  expected_tables text[] := array[
    'post_likes',
    'post_replies',
    'post_shares',
    'notifications'
  ];
  expected_policies text[] := array[
    'post_likes_select_members',
    'post_replies_select_members',
    'post_shares_select_members',
    'notifications_select_recipient'
  ];
  writable_privilege text;
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

    -- Every reaction is written by an RPC that locks the circle and re-checks
    -- membership, so direct writes have to stay out of reach. Reading a
    -- notification is limited by the policy rather than by the grant.
    foreach writable_privilege in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if pg_catalog.has_table_privilege(
        'authenticated',
        'public.' || missing,
        writable_privilege
      ) then
        raise exception
          'authenticated can still % public.% directly',
          writable_privilege,
          missing;
      end if;
    end loop;

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

  -- The timeline has to be the version that reports reactions. The phase 4
  -- version has the same name and arguments and would leave every post looking
  -- as though nobody had ever touched it.
  if not exists (
    select 1
    from pg_catalog.pg_proc as routine
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname = 'list_group_posts'
      and pg_catalog.pg_get_function_result(routine.oid) like '%liked_by_viewer%'
  ) then
    raise exception
      'list_group_posts does not report reactions: apply 20260728000200';
  end if;

  -- A reply has nowhere to record a parent, which is what keeps a conversation
  -- one level deep no matter what a client asks for.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'post_replies'
      and column_name in ('parent_reply_id', 'parent_id', 'reply_id', 'depth')
  ) then
    raise exception 'post_replies carries a parent reference: replies can nest';
  end if;

  -- One like notification per post and admirer, so toggling cannot be used to
  -- fill somebody's list.
  if not exists (
    select 1
    from pg_catalog.pg_index as index_entry
    join pg_catalog.pg_class as index_relation
      on index_relation.oid = index_entry.indexrelid
    where index_relation.relname = 'notifications_like_once_idx'
      and index_entry.indisunique
      and index_entry.indpred is not null
  ) then
    raise exception
      'the notifications_like_once_idx unique partial index is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_type as enum_type
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = enum_type.typnamespace
    where namespace.nspname = 'public'
      and enum_type.typname = 'notification_kind'
      and (
        select pg_catalog.count(*)
        from pg_catalog.pg_enum as label
        where label.enumtypid = enum_type.oid
      ) = 3
  ) then
    raise exception
      'public.notification_kind is missing or does not have three kinds';
  end if;

  -- the policies that keep one circle out of another circle's reactions, and
  -- one member out of another member's notifications
  foreach missing in array expected_policies loop
    if not exists (
      select 1
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.policyname = missing
    ) then
      raise exception 'the policy % is missing', missing;
    end if;
  end loop;

  raise notice 'phase 5 schema verification: PASS';
end
$verify$;

-- The Supabase SQL editor does not show notices, and a do block returns no
-- rows, so on its own the check above is indistinguishable from having run
-- nothing at all. This returns the verdict as a row that the editor will
-- actually display. Reaching it at all means every assertion above held.
select 'phase 5 schema verification: PASS' as result;
