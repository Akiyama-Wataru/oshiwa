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
cluster_root="$(mktemp -d /private/tmp/oshiwa-posts.XXXXXX)"
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
    /private/tmp/oshiwa-posts.*)
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
  -f "${repository_root}/supabase/tests/posts_rls.sql"

echo "post/timeline migration smoke and invariants: PASS"
