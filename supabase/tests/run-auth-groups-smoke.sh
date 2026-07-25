#!/usr/bin/env bash
set -euo pipefail

# The throwaway cluster must not inherit the developer's locale: an unusable
# LC_* value makes the postmaster abort during startup on macOS. It also has to
# speak UTF-8 like hosted Supabase.
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
cluster_root="$(mktemp -d /private/tmp/oshiwa-auth-groups.XXXXXX)"
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
    /private/tmp/oshiwa-auth-groups.*)
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

psql "${psql_args[@]}" <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

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
SQL

psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/migrations/20260724000100_auth_groups.sql"
psql "${psql_args[@]}" \
  -f "${repository_root}/supabase/tests/auth_groups_rls.sql"

concurrent_invite_token="$(
  psql "${psql_args[@]}" \
    -qAt \
    -f "${repository_root}/supabase/tests/concurrent_accept_setup.sql"
)"

if [[ ! "${concurrent_invite_token}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Concurrent setup returned an invalid invite token" >&2
  exit 1
fi

psql "${psql_args[@]}" \
  -v invite_token="${concurrent_invite_token}" \
  -f "${repository_root}/supabase/tests/concurrent_accept_hold_lock.sql" \
  >"${cluster_root}/concurrent-lock.log" 2>&1 &
concurrent_lock_pid=$!

concurrent_lock_ready=0
for _ in {1..50}; do
  if [[ "$(
    psql "${psql_args[@]}" -qAt -c \
      "select exists (
        select 1
        from pg_catalog.pg_locks
        where locktype = 'advisory'
          and objid = 240724
          and granted
      )"
  )" == "t" ]]; then
    concurrent_lock_ready=1
    break
  fi
  sleep 0.05
done

if [[ "${concurrent_lock_ready}" -ne 1 ]]; then
  echo "Concurrent acceptance lock holder did not become ready" >&2
  wait "${concurrent_lock_pid}" || true
  exit 1
fi

set +e
psql "${psql_args[@]}" \
  -v accept_user_id="10000000-0000-0000-0000-000000000003" \
  -v invite_token="${concurrent_invite_token}" \
  -f "${repository_root}/supabase/tests/concurrent_accept_connection.sql" \
  >"${cluster_root}/concurrent-accept-first.log" 2>&1 &
accept_first_pid=$!

psql "${psql_args[@]}" \
  -v accept_user_id="10000000-0000-0000-0000-000000000002" \
  -v invite_token="${concurrent_invite_token}" \
  -f "${repository_root}/supabase/tests/concurrent_accept_connection.sql" \
  >"${cluster_root}/concurrent-accept-second.log" 2>&1 &
accept_second_pid=$!

concurrent_waiters_ready=0
for _ in {1..40}; do
  concurrent_waiter_count="$(
    psql "${psql_args[@]}" -qAt -c \
      "select pg_catalog.count(*)
       from pg_catalog.pg_stat_activity
       where pid <> pg_catalog.pg_backend_pid()
         and datname = pg_catalog.current_database()
         and state = 'active'
         and wait_event_type = 'Lock'
         and query like '%public.accept_invitation%'"
  )"
  if [[ "${concurrent_waiter_count}" -ge 2 ]]; then
    concurrent_waiters_ready=1
    break
  fi
  sleep 0.05
done

wait "${accept_first_pid}"
accept_first_status=$?
wait "${accept_second_pid}"
accept_second_status=$?
wait "${concurrent_lock_pid}"
concurrent_lock_status=$?
set -e

if [[ "${concurrent_waiters_ready}" -ne 1 ]]; then
  echo "Both acceptance connections did not contend on the locked row" >&2
  cat "${cluster_root}/concurrent-accept-first.log" >&2
  cat "${cluster_root}/concurrent-accept-second.log" >&2
  exit 1
fi

if [[ "${concurrent_lock_status}" -ne 0 ]]; then
  cat "${cluster_root}/concurrent-lock.log" >&2
  exit 1
fi

successful_accepts=0
if [[ "${accept_first_status}" -eq 0 ]]; then
  successful_accepts=$((successful_accepts + 1))
fi
if [[ "${accept_second_status}" -eq 0 ]]; then
  successful_accepts=$((successful_accepts + 1))
fi

if [[ "${successful_accepts}" -ne 1 ]]; then
  echo "Expected exactly one concurrent acceptance success" >&2
  cat "${cluster_root}/concurrent-accept-first.log" >&2
  cat "${cluster_root}/concurrent-accept-second.log" >&2
  exit 1
fi

if [[ "${accept_first_status}" -eq 0 ]]; then
  concurrent_accepted_user_id="10000000-0000-0000-0000-000000000003"
  concurrent_rejected_user_id="10000000-0000-0000-0000-000000000002"
else
  concurrent_accepted_user_id="10000000-0000-0000-0000-000000000002"
  concurrent_rejected_user_id="10000000-0000-0000-0000-000000000003"
fi

if [[ "${accept_first_status}" -ne 0 ]]; then
  concurrent_loser_log="${cluster_root}/concurrent-accept-first.log"
else
  concurrent_loser_log="${cluster_root}/concurrent-accept-second.log"
fi

if ! grep -q "22023" "${concurrent_loser_log}" ||
  ! grep -q "Invitation is invalid or unavailable" "${concurrent_loser_log}"
then
  echo "Concurrent loser failed for an unexpected reason" >&2
  cat "${concurrent_loser_log}" >&2
  exit 1
fi

# The winning actor can retry after an application-layer failure (for
# example, password setup) without creating a second membership.
psql "${psql_args[@]}" \
  -v accept_user_id="${concurrent_accepted_user_id}" \
  -v invite_token="${concurrent_invite_token}" \
  -f "${repository_root}/supabase/tests/concurrent_accept_connection.sql" \
  >"${cluster_root}/concurrent-accept-winner-retry.log" 2>&1

# The rejected actor remains rejected on every later replay.
set +e
psql "${psql_args[@]}" \
  -v accept_user_id="${concurrent_rejected_user_id}" \
  -v invite_token="${concurrent_invite_token}" \
  -f "${repository_root}/supabase/tests/concurrent_accept_connection.sql" \
  >"${cluster_root}/concurrent-accept-loser-retry.log" 2>&1
rejected_retry_status=$?
set -e

if [[ "${rejected_retry_status}" -eq 0 ]] ||
  ! grep -q "22023" "${cluster_root}/concurrent-accept-loser-retry.log" ||
  ! grep -q "Invitation is invalid or unavailable" \
    "${cluster_root}/concurrent-accept-loser-retry.log"
then
  echo "Concurrent rejected actor replay did not remain rejected" >&2
  cat "${cluster_root}/concurrent-accept-loser-retry.log" >&2
  exit 1
fi

psql "${psql_args[@]}" \
  -v invite_token="${concurrent_invite_token}" \
  -v accepted_user_id="${concurrent_accepted_user_id}" \
  -v rejected_user_id="${concurrent_rejected_user_id}" \
  -f "${repository_root}/supabase/tests/concurrent_accept_verify.sql"

echo "auth/groups migration smoke, invariants, and concurrent_accept: PASS"
