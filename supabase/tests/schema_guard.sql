\set ON_ERROR_STOP on

-- Invariants that hold for the schema as a whole rather than for one feature.
--
-- The per-feature files name the tables and functions they test, so a table
-- added later is simply not covered by them. These checks look at whatever is
-- actually there, which is what makes them useful to the phase that has not
-- been written yet: a new table without row level security, or a grant that
-- lets a member write directly, fails here without anybody remembering to add
-- a case.

begin;

-- Every table a client can name must have row level security, forced. Enabled
-- but not forced would leave the owner able to read past every policy, and the
-- policies are the group boundary.
create function pg_temp.tables_without_forced_rls()
returns text[]
language sql
stable
as $function$
  select coalesce(
    pg_catalog.array_agg(relation.relname order by relation.relname),
    array[]::text[]
  )
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and not (relation.relrowsecurity and relation.relforcerowsecurity)
$function$;

do $assert$
declare
  unprotected text[] := pg_temp.tables_without_forced_rls();
begin
  if pg_catalog.array_length(unprotected, 1) > 0 then
    raise exception
      'these public tables do not force row level security: %',
      unprotected;
  end if;
end
$assert$;

-- A check of this shape passes on an empty schema as readily as on a correct
-- one, so here is a table that should fail it. Without this, a query that
-- silently stopped matching anything would read as a clean bill of health.
savepoint before_probe;

create table public.schema_guard_probe (id uuid primary key);

do $assert$
begin
  if not (
    pg_temp.tables_without_forced_rls() @> array['schema_guard_probe']
  ) then
    raise exception
      'the row level security check did not notice a table without it';
  end if;
end
$assert$;

rollback to savepoint before_probe;

-- Writes go through the RPCs, which lock the circle and re-check membership.
-- A direct grant anywhere would route around that.
do $assert$
declare
  writable text[];
begin
  select coalesce(
    pg_catalog.array_agg(
      grants.grantee || ' ' || grants.privilege_type || ' ' || grants.table_name
      order by grants.table_name, grants.privilege_type
    ),
    array[]::text[]
  )
  into writable
  from information_schema.role_table_grants as grants
  where grants.table_schema = 'public'
    and grants.grantee in ('anon', 'authenticated')
    and grants.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  if pg_catalog.array_length(writable, 1) > 0 then
    raise exception 'these direct write grants exist: %', writable;
  end if;
end
$assert$;

-- Nothing in public is readable by a signed out caller. The invitation flow
-- runs as authenticated after the link is confirmed, so anon never needs a row.
do $assert$
declare
  readable text[];
begin
  select coalesce(
    pg_catalog.array_agg(distinct grants.table_name order by grants.table_name),
    array[]::text[]
  )
  into readable
  from information_schema.role_table_grants as grants
  where grants.table_schema = 'public'
    and grants.grantee = 'anon';

  if pg_catalog.array_length(readable, 1) > 0 then
    raise exception 'anon can still reach these tables: %', readable;
  end if;
end
$assert$;

-- A definer function runs with the owner's rights, so an unset search_path
-- would let a caller's own schema decide what "posts" means.
do $assert$
declare
  unpinned text[];
begin
  select coalesce(
    pg_catalog.array_agg(
      namespace.nspname || '.' || routine.proname
      order by namespace.nspname, routine.proname
    ),
    array[]::text[]
  )
  into unpinned
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = routine.pronamespace
  where namespace.nspname in ('public', 'private')
    and routine.prosecdef
    and not exists (
      select 1
      from pg_catalog.unnest(
        coalesce(routine.proconfig, array[]::text[])
      ) as setting(entry)
      where setting.entry like 'search\_path=%'
    );

  if pg_catalog.array_length(unpinned, 1) > 0 then
    raise exception
      'these security definer functions do not pin search_path: %',
      unpinned;
  end if;
end
$assert$;

-- The private schema holds the helpers that decide permission. A signed out
-- caller has no business executing any of them.
do $assert$
declare
  reachable text[];
begin
  select coalesce(
    pg_catalog.array_agg(routine.proname order by routine.proname),
    array[]::text[]
  )
  into reachable
  from pg_catalog.pg_proc as routine
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = routine.pronamespace
  where namespace.nspname = 'private'
    and pg_catalog.has_function_privilege('anon', routine.oid, 'EXECUTE');

  if pg_catalog.array_length(reachable, 1) > 0 then
    raise exception 'anon can execute these private helpers: %', reachable;
  end if;
end
$assert$;

-- Row level security with no policy denies everything, which is safe but is
-- never what was meant: it would be a table nobody can read, shipped by
-- accident.
do $assert$
declare
  policyless text[];
begin
  select coalesce(
    pg_catalog.array_agg(relation.relname order by relation.relname),
    array[]::text[]
  )
  into policyless
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and not exists (
      select 1
      from pg_catalog.pg_policy as policy
      where policy.polrelid = relation.oid
    );

  if pg_catalog.array_length(policyless, 1) > 0 then
    raise exception 'these tables have no policy at all: %', policyless;
  end if;
end
$assert$;

rollback;
