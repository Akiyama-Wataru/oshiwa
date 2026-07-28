#!/usr/bin/env bash
set -euo pipefail

# The throwaway cluster must not inherit the developer's locale: an unusable
# LC_* value makes the postmaster abort during startup on macOS. It also has to
# speak UTF-8 like hosted Supabase, otherwise character classes such as
# [[:cntrl:]] would judge Japanese names byte by byte.
utf8_locale=""
for locale_candidate in C.UTF-8 en_US.UTF-8; do
  if [[ "$(LC_ALL="${locale_candidate}" locale charmap 2>/dev/null)" == "UTF-8" ]]
  then
    utf8_locale="${locale_candidate}"
    break
  fi
done

if [[ -z "${utf8_locale}" ]]; then
  echo "No UTF-8 locale is available for the throwaway cluster" >&2
  exit 1
fi

export LC_ALL="${utf8_locale}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_dir}/../.." && pwd)"
# The cleanup below deletes this tree, so the prefix it has to match is
# written once and reused rather than repeated as a literal. TMPDIR keeps
# it portable: /private/tmp exists on macOS but not on a Linux runner.
temporary_root="${TMPDIR:-/tmp}"
cluster_prefix="${temporary_root%/}/oshiwa-posts."
cluster_root="$(mktemp -d "${cluster_prefix}XXXXXX")"
data_dir="${cluster_root}/data"
socket_dir="${cluster_root}/socket"
server_log="${cluster_root}/postgres.log"
server_started=0

cleanup() {
  local exit_status=$?
  trap - EXIT INT TERM
  set +e

  if [[ "${server_started}" -eq 1 ]]; then
    pg_ctl -D "${data_dir}" stop -m immediate >/dev/null 2>&1 || true
    server_started=0
  fi

  case "${cluster_root}" in
    "${cluster_prefix}"*)
      rm -rf -- "${cluster_root}"
      ;;
    *)
      echo "Refusing to clean unexpected path: ${cluster_root}" >&2
      exit_status=1
      ;;
  esac

  exit "${exit_status}"
}
trap cleanup EXIT INT TERM

mkdir -p "${socket_dir}"
initdb \
  -D "${data_dir}" \
  -A trust \
  -U postgres \
  --encoding=UTF8 \
  --locale="${utf8_locale}" >/dev/null
pg_ctl \
  -D "${data_dir}" \
  -l "${server_log}" \
  -o "-F -c listen_addresses='' -k ${socket_dir}" \
  start >/dev/null
server_started=1

psql_args=(
  -X
  -v ON_ERROR_STOP=1
  -h "${socket_dir}"
  -U postgres
  -d postgres
)

# Stand in for the Supabase-managed auth and storage schemas. Row level
# security is intentionally left off on storage.objects so the migration has to
# turn it on itself.
psql "${psql_args[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

-- Hosted Supabase lets the API roles reach auth.uid(). Without this grant the
-- harness refuses at the schema instead of at the table, and every assertion
-- that a direct write is revoked would pass for the wrong reason.
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $function$
  select nullif(
    pg_catalog.current_setting('request.jwt.claim.sub', true),
    ''
  )::uuid
$function$;

-- Hosted Supabase gives the storage schema its own owner, and PostgreSQL
-- evaluates row level security expressions with the table owner's privileges.
-- Reproducing that ownership here is what makes the storage policies fail in
-- this harness when they reach a schema their owner cannot see.
create role supabase_storage_admin nologin;
create schema storage authorization supabase_storage_admin;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default pg_catalog.now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default pg_catalog.now(),
  unique (bucket_id, name)
);

alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
SQL

psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260724000100_auth_groups.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260725000100_oshis_media.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260726000100_storage_policy_privileges.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260726000200_private_schema_usage.sql"

storage_rls_enabled="$(
  psql "${psql_args[@]}" -qAt -c \
    "select relation.relrowsecurity
     from pg_catalog.pg_class as relation
     join pg_catalog.pg_namespace as namespace
       on namespace.oid = relation.relnamespace
     where namespace.nspname = 'storage'
       and relation.relname = 'objects'"
)"

if [[ "${storage_rls_enabled}" != "t" ]]; then
  echo "Migration did not enable row level security on storage.objects" >&2
  exit 1
fi

psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260727000100_posts_timeline.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260728000100_posts_timeline_read.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260728000200_reactions_notifications.sql"

# The same script the operator runs against the hosted project, so it cannot
# rot into passing on a schema that no longer matches the migrations.
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/verify-posts-schema.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/verify-reactions-schema.sql"

psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/tests/posts_rls.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/tests/posts_timeline.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/tests/reactions.sql"

# Whole schema invariants. This runs last, against every migration applied
# above, so a table added by a later phase is covered without anybody adding a
# case for it.
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/tests/schema_guard.sql"

# Two connections tapping the same like at once. The invariants above run in one
# transaction and so cannot say anything about contention.
concurrent_like_post_id="$(
  psql "${psql_args[@]}" \
    -qAt \
    -f "${repository_root}/supabase/tests/concurrent_like_setup.sql"
)"

if [[ ! "${concurrent_like_post_id}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
then
  echo "Concurrent like setup returned an invalid post id" >&2
  exit 1
fi

psql "${psql_args[@]}" \
  -v post_id="${concurrent_like_post_id}" \
  -f "${repository_root}/supabase/tests/concurrent_like_hold_lock.sql" \
  >"${cluster_root}/concurrent-like-lock.log" 2>&1 &
like_lock_pid=$!

like_lock_ready=0
for _ in {1..50}; do
  if [[ "$(
    psql "${psql_args[@]}" -qAt -c \
      "select exists (
        select 1
        from pg_catalog.pg_locks
        where locktype = 'advisory'
          and objid = 240728
          and granted
      )"
  )" == "t" ]]; then
    like_lock_ready=1
    break
  fi
  sleep 0.05
done

if [[ "${like_lock_ready}" -ne 1 ]]; then
  echo "Concurrent like lock holder did not become ready" >&2
  wait "${like_lock_pid}" || true
  exit 1
fi

set +e
psql "${psql_args[@]}" \
  -qAt \
  -v like_user_id="60000000-0000-0000-0000-000000000002" \
  -v post_id="${concurrent_like_post_id}" \
  -f "${repository_root}/supabase/tests/concurrent_like_connection.sql" \
  >"${cluster_root}/concurrent-like-first.log" 2>&1 &
like_first_pid=$!

psql "${psql_args[@]}" \
  -qAt \
  -v like_user_id="60000000-0000-0000-0000-000000000002" \
  -v post_id="${concurrent_like_post_id}" \
  -f "${repository_root}/supabase/tests/concurrent_like_connection.sql" \
  >"${cluster_root}/concurrent-like-second.log" 2>&1 &
like_second_pid=$!

like_waiters_ready=0
for _ in {1..40}; do
  like_waiter_count="$(
    psql "${psql_args[@]}" -qAt -c \
      "select pg_catalog.count(*)
       from pg_catalog.pg_stat_activity
       where pid <> pg_catalog.pg_backend_pid()
         and datname = pg_catalog.current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query like '%public.toggle_post_like%'"
  )"
  if [[ "${like_waiter_count}" -ge 2 ]]; then
    like_waiters_ready=1
    break
  fi
  sleep 0.05
done

wait "${like_first_pid}"
like_first_status=$?
wait "${like_second_pid}"
like_second_status=$?
wait "${like_lock_pid}"
like_lock_status=$?
set -e

if [[ "${like_waiters_ready}" -ne 1 ]]; then
  echo "Both taps did not contend on the locked circle" >&2
  cat "${cluster_root}/concurrent-like-first.log" >&2
  cat "${cluster_root}/concurrent-like-second.log" >&2
  exit 1
fi

if [[ "${like_first_status}" -ne 0 ]] ||
  [[ "${like_second_status}" -ne 0 ]] ||
  [[ "${like_lock_status}" -ne 0 ]]
then
  echo "A concurrent tap failed rather than taking its turn" >&2
  cat "${cluster_root}/concurrent-like-lock.log" >&2
  cat "${cluster_root}/concurrent-like-first.log" >&2
  cat "${cluster_root}/concurrent-like-second.log" >&2
  exit 1
fi

concurrent_like_verdicts="$(
  cat \
    "${cluster_root}/concurrent-like-first.log" \
    "${cluster_root}/concurrent-like-second.log" |
    sort |
    tr -d '[:space:]'
)"

if [[ "${concurrent_like_verdicts}" != "ft" ]]; then
  echo "The two taps answered '${concurrent_like_verdicts}' rather than one" \
    "like and one withdrawal" >&2
  cat "${cluster_root}/concurrent-like-first.log" >&2
  cat "${cluster_root}/concurrent-like-second.log" >&2
  exit 1
fi

psql "${psql_args[@]}" \
  -v post_id="${concurrent_like_post_id}" \
  -f "${repository_root}/supabase/tests/concurrent_like_verify.sql"

echo "post/timeline migration smoke, invariants, and concurrent_like: PASS"
