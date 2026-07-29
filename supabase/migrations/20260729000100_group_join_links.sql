begin;

-- One time join links.
--
-- The email invitation binds a circle to one confirmed address, which is the
-- stronger boundary and stays in place. This adds the other shape a small
-- circle actually uses: a link handed over in a chat.
--
-- What keeps that closed is the single use. The link carries no identity, so
-- the only thing standing between a forwarded link and a stranger is that the
-- first person through spends it. That is enforced here, under the circle's
-- row lock, rather than by asking the caller to check first.

create table public.group_join_links (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Only the digest, exactly as with invitation tokens: a leaked backup must
  -- not hand somebody a working link.
  token_hash bytea not null unique
    check (pg_catalog.octet_length(token_hash) = 32),
  created_by uuid not null references public.profiles (id) on delete restrict,
  role public.membership_role not null default 'member'
    check (role <> 'owner'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null),
  -- Spent means spent by somebody: the two halves cannot drift apart.
  check ((accepted_at is null) = (accepted_by is null))
);

create index group_join_links_group_idx
  on public.group_join_links (group_id, created_at desc);

create index group_join_links_live_idx
  on public.group_join_links (group_id, expires_at)
  where accepted_at is null and revoked_at is null;

alter table public.group_join_links enable row level security;
alter table public.group_join_links force row level security;

-- Managers see the links their circle has handed out. A plain member has no
-- business reading them, and the person holding a link does not need to read
-- the row to use it.
create policy group_join_links_select_managers
  on public.group_join_links
  for select
  to authenticated
  using (
    private.has_group_role(
      group_id,
      array['owner', 'admin']::public.membership_role[]
    )
  );

create or replace function public.create_group_join_link(
  target_group_id uuid,
  invited_role public.membership_role default 'member',
  expires_in interval default interval '24 hours'
)
returns table (
  link_id uuid,
  link_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  raw_token text;
  raw_token_hash bytea;
  created_link_id uuid;
  link_expires_at timestamptz;
  recent_link_count bigint;
  live_link_count bigint;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  -- Ownership is never handed over by a link. Somebody who holds a link is
  -- only known to have held a link.
  if invited_role not in ('admin', 'member') then
    raise exception using
      errcode = '22023',
      message = 'Join links may grant only admin or member';
  end if;

  -- Short by default and never long: a link is a bearer token, and its
  -- lifetime is the window in which a forward is worth anything.
  if expires_in is null
    or expires_in <= interval '0 seconds'
    or expires_in > interval '7 days'
  then
    raise exception using
      errcode = '22023',
      message = 'Join link lifetime must be between 0 and 7 days';
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
      message = 'Group manager permission required';
  end if;

  select pg_catalog.count(*)
  into recent_link_count
  from public.group_join_links as link
  where link.created_by = acting_user_id
    and link.created_at
      > pg_catalog.statement_timestamp() - interval '1 hour';

  if recent_link_count >= 20 then
    raise exception using
      errcode = '22023',
      message = 'Hourly join link quota exceeded';
  end if;

  select pg_catalog.count(*)
  into live_link_count
  from public.group_join_links as link
  where link.group_id = target_group_id
    and link.accepted_at is null
    and link.revoked_at is null
    and link.expires_at > pg_catalog.statement_timestamp();

  if live_link_count >= 20 then
    raise exception using
      errcode = '22023',
      message = 'Live join link quota exceeded';
  end if;

  raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  raw_token_hash := extensions.digest(
    pg_catalog.convert_to(raw_token, 'UTF8'),
    'sha256'
  );
  link_expires_at := pg_catalog.statement_timestamp() + expires_in;

  insert into public.group_join_links (
    group_id,
    token_hash,
    created_by,
    role,
    expires_at
  )
  values (
    target_group_id,
    raw_token_hash,
    acting_user_id,
    invited_role,
    link_expires_at
  )
  returning id into created_link_id;

  -- The only time the raw token exists anywhere. The caller shows it once.
  return query select created_link_id, raw_token, link_expires_at;
end
$function$;

revoke all on function public.create_group_join_link(
  uuid,
  public.membership_role,
  interval
) from public;

create or replace function public.accept_group_join_link(link_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  supplied_hash bytea;
  candidate_group_id uuid;
  locked_link public.group_join_links%rowtype;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if link_token is null or link_token !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Join link is invalid or unavailable';
  end if;

  supplied_hash := extensions.digest(
    pg_catalog.convert_to(link_token, 'UTF8'),
    'sha256'
  );

  select link.group_id
  into candidate_group_id
  from public.group_join_links as link
  where link.token_hash = supplied_hash;

  -- Unknown, spent, revoked and expired all answer the same. A different
  -- message for each would turn this into a way to probe which links exist.
  if candidate_group_id is null then
    raise exception using
      errcode = '22023',
      message = 'Join link is invalid or unavailable';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = candidate_group_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Join link is invalid or unavailable';
  end if;

  -- Somebody already in the circle has nothing to gain here, and must not
  -- spend the link on their way past.
  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id = candidate_group_id
      and membership.user_id = acting_user_id
  ) then
    return candidate_group_id;
  end if;

  select *
  into locked_link
  from public.group_join_links as link
  where link.token_hash = supplied_hash
  for update;

  if not found
    or locked_link.accepted_at is not null
    or locked_link.revoked_at is not null
    or locked_link.expires_at <= pg_catalog.statement_timestamp()
  then
    raise exception using
      errcode = '22023',
      message = 'Join link is invalid or unavailable';
  end if;

  -- Spending and joining happen together, under the same lock, so two people
  -- opening the link at once cannot both get through.
  update public.group_join_links as link
  set
    accepted_at = pg_catalog.statement_timestamp(),
    accepted_by = acting_user_id
  where link.id = locked_link.id;

  insert into public.memberships (group_id, user_id, role)
  values (candidate_group_id, acting_user_id, locked_link.role);

  return candidate_group_id;
end
$function$;

revoke all on function public.accept_group_join_link(text) from public;

create or replace function public.revoke_group_join_link(target_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  acting_user_id uuid := auth.uid();
  owning_group_id uuid;
  revoked_link_id uuid;
begin
  if acting_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select link.group_id
  into owning_group_id
  from public.group_join_links as link
  where link.id = target_link_id;

  if owning_group_id is null then
    return false;
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = owning_group_id
  for update;

  if not found or not private.has_group_role(
    owning_group_id,
    array['owner', 'admin']::public.membership_role[]
  ) then
    raise exception using
      errcode = '42501',
      message = 'Group manager permission required';
  end if;

  update public.group_join_links as link
  set revoked_at = pg_catalog.statement_timestamp()
  where link.id = target_link_id
    and link.accepted_at is null
    and link.revoked_at is null
  returning link.id into revoked_link_id;

  return revoked_link_id is not null;
end
$function$;

revoke all on function public.revoke_group_join_link(uuid) from public;

revoke all on table public.group_join_links from public, anon, authenticated;

grant select on public.group_join_links to authenticated;
grant all on public.group_join_links to service_role;

grant execute on function public.create_group_join_link(
  uuid,
  public.membership_role,
  interval
) to authenticated;
grant execute on function public.accept_group_join_link(text) to authenticated;
grant execute on function public.revoke_group_join_link(uuid) to authenticated;

commit;
