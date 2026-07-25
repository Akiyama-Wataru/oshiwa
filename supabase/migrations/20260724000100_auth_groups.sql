begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
revoke create on schema public from public;
revoke usage on schema public from public, anon;
grant usage on schema public to authenticated, service_role;

create type public.membership_role as enum ('owner', 'admin', 'member');
create type public.invitation_delivery_state as enum (
  'pending',
  'sent',
  'failed'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (
      pg_catalog.char_length(pg_catalog.btrim(display_name)) between 1 and 80
    ),
  avatar_url text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.groups (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null
    check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 100),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create index groups_created_by_idx
  on public.groups (created_by, created_at desc);

create table public.memberships (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (group_id, user_id)
);

create index memberships_user_id_idx
  on public.memberships (user_id, group_id);

create table public.invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  email_normalized text not null
    check (
      email_normalized = pg_catalog.lower(pg_catalog.btrim(email_normalized))
      and pg_catalog.char_length(email_normalized) between 3 and 320
    ),
  token_hash bytea not null unique
    check (pg_catalog.octet_length(token_hash) = 32),
  invited_by uuid not null references public.profiles (id) on delete restrict,
  role public.membership_role not null default 'member'
    check (role <> 'owner'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  delivery_state public.invitation_delivery_state not null default 'pending',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  check (expires_at > created_at),
  check (accepted_at is null or revoked_at is null)
);

create index invitations_group_id_idx
  on public.invitations (group_id, created_at desc);
create index invitations_email_idx
  on public.invitations (email_normalized, group_id);
create index invitations_invited_by_created_at_idx
  on public.invitations (invited_by, created_at desc);
create index invitations_group_live_pending_idx
  on public.invitations (group_id, expires_at)
  where accepted_at is null and revoked_at is null;

-- Future group-owned tables MUST carry group_id through every relationship.
-- Give each parent UNIQUE (group_id, id), then make every child use a
-- FOREIGN KEY (group_id, parent_id) REFERENCES parent (group_id, id).
-- This composite-FK rule prevents posts/comments/media from linking across
-- groups even when a globally valid child or parent UUID is supplied.

create or replace function private.current_verified_email()
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.lower(pg_catalog.btrim(users.email))
  from auth.users as users
  where users.id = (select auth.uid())
    and users.email_confirmed_at is not null
$function$;

revoke all on function private.current_verified_email() from public;

create or replace function private.is_group_member(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    exists (
      select 1
      from public.memberships as membership
      where membership.group_id = target_group_id
        and membership.user_id = (select auth.uid())
    ),
    false
  )
$function$;

revoke all on function private.is_group_member(uuid) from public;

create or replace function private.has_group_role(
  target_group_id uuid,
  allowed_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    exists (
      select 1
      from public.memberships as membership
      where membership.group_id = target_group_id
        and membership.user_id = (select auth.uid())
        and membership.role = any (allowed_roles)
    ),
    false
  )
$function$;

revoke all on function private.has_group_role(
  uuid,
  public.membership_role[]
) from public;

create or replace function private.can_view_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    exists (
      select 1
      from public.memberships as viewer_membership
      join public.memberships as target_membership
        on target_membership.group_id = viewer_membership.group_id
      where viewer_membership.user_id = (select auth.uid())
        and target_membership.user_id = target_user_id
    ),
    false
  )
$function$;

revoke all on function private.can_view_profile(uuid) from public;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  derived_display_name text;
begin
  derived_display_name := pg_catalog.left(
    coalesce(
      nullif(
        pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name'),
        ''
      ),
      nullif(pg_catalog.split_part(new.email, '@', 1), ''),
      'Member'
    ),
    80
  );

  insert into public.profiles (id, display_name)
  values (new.id, derived_display_name)
  on conflict (id) do nothing;

  return new;
end
$function$;

revoke all on function private.handle_new_user() from public;

insert into public.profiles (id, display_name)
select
  users.id,
  pg_catalog.left(
    coalesce(
      nullif(
        pg_catalog.btrim(users.raw_user_meta_data ->> 'display_name'),
        ''
      ),
      nullif(pg_catalog.split_part(users.email, '@', 1), ''),
      'Member'
    ),
    80
  )
from auth.users as users
on conflict (id) do nothing;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.groups enable row level security;
alter table public.groups force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
alter table public.invitations enable row level security;
alter table public.invitations force row level security;

create policy profiles_select_shared_group
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or private.can_view_profile(id)
  );

create policy groups_select_members
  on public.groups
  for select
  to authenticated
  using (private.is_group_member(id));

create policy memberships_select_group_members
  on public.memberships
  for select
  to authenticated
  using (private.is_group_member(group_id));

create policy invitations_select_managers
  on public.invitations
  for select
  to authenticated
  using (
    private.has_group_role(
      group_id,
      array['owner', 'admin']::public.membership_role[]
    )
  );

create or replace function public.create_group(group_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_name text := pg_catalog.btrim(group_name);
  created_group_id uuid;
  created_group_count bigint;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if normalized_name is null
    or pg_catalog.char_length(normalized_name) not between 1 and 100
  then
    raise exception using
      errcode = '22023',
      message = 'Group name must contain 1 to 100 characters';
  end if;

  perform 1
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Authenticated profile is unavailable';
  end if;

  select pg_catalog.count(*)
  into created_group_count
  from public.groups as target_group
  where target_group.created_by = actor_id;

  if created_group_count >= 20 then
    raise exception using
      errcode = '22023',
      message = 'Group creation quota exceeded';
  end if;

  insert into public.groups (name, created_by)
  values (normalized_name, actor_id)
  returning id into created_group_id;

  insert into public.memberships (group_id, user_id, role)
  values (created_group_id, actor_id, 'owner');

  return created_group_id;
end
$function$;

revoke all on function public.create_group(text) from public;

create or replace function public.create_invitation(
  target_group_id uuid,
  invitee_email text,
  invited_role public.membership_role default 'member',
  expires_in interval default interval '7 days'
)
returns table (
  invitation_id uuid,
  invite_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(invitee_email));
  raw_token text;
  raw_token_hash bytea;
  created_invitation_id uuid;
  invitation_expires_at timestamptz;
  recent_invitation_count bigint;
  live_pending_invitation_count bigint;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if normalized_email is null
    or pg_catalog.char_length(normalized_email) > 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then
    raise exception using
      errcode = '22023',
      message = 'A valid invitee email is required';
  end if;

  if invited_role not in ('admin', 'member') then
    raise exception using
      errcode = '22023',
      message = 'Invitations may grant only admin or member';
  end if;

  if expires_in is null
    or expires_in <= interval '0 seconds'
    or expires_in > interval '30 days'
  then
    raise exception using
      errcode = '22023',
      message = 'Invitation lifetime must be between 0 and 30 days';
  end if;

  -- All invitation creation, acceptance, and manager mutations lock the
  -- group row before touching invitation rows. This prevents lock inversion
  -- and makes the manager authorization check fresh at the mutation point.
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

  -- The actor profile is a cross-group serialization point for the rolling
  -- inviter quota. It is acquired only after the group row.
  perform 1
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Authenticated profile is unavailable';
  end if;

  select pg_catalog.count(*)
  into recent_invitation_count
  from public.invitations as invitation
  where invitation.invited_by = actor_id
    and invitation.created_at >
      pg_catalog.statement_timestamp() - interval '1 hour';

  if recent_invitation_count >= 20 then
    raise exception using
      errcode = '22023',
      message = 'Hourly invitation quota exceeded';
  end if;

  select pg_catalog.count(*)
  into live_pending_invitation_count
  from public.invitations as invitation
  where invitation.group_id = target_group_id
    and invitation.delivery_state in ('pending', 'sent', 'failed')
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > pg_catalog.statement_timestamp();

  if live_pending_invitation_count >= 100 then
    raise exception using
      errcode = '22023',
      message = 'Live pending invitation quota exceeded';
  end if;

  raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  raw_token_hash := extensions.digest(
    pg_catalog.convert_to(raw_token, 'UTF8'),
    'sha256'
  );
  invitation_expires_at := pg_catalog.statement_timestamp() + expires_in;

  insert into public.invitations (
    group_id,
    email_normalized,
    token_hash,
    invited_by,
    role,
    expires_at
  )
  values (
    target_group_id,
    normalized_email,
    raw_token_hash,
    actor_id,
    invited_role,
    invitation_expires_at
  )
  returning id into created_invitation_id;

  return query
    select created_invitation_id, raw_token, invitation_expires_at;
end
$function$;

revoke all on function public.create_invitation(
  uuid,
  text,
  public.membership_role,
  interval
) from public;

create or replace function public.accept_invitation(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  supplied_hash bytea;
  candidate_group_id uuid;
  locked_invitation public.invitations%rowtype;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if invite_token is null or invite_token !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Invitation is invalid or unavailable';
  end if;

  actor_email := private.current_verified_email();
  if actor_email is null then
    raise exception using
      errcode = '42501',
      message = 'A verified account email is required';
  end if;

  supplied_hash := extensions.digest(
    pg_catalog.convert_to(invite_token, 'UTF8'),
    'sha256'
  );

  select invitation.group_id
  into candidate_group_id
  from public.invitations as invitation
  where invitation.token_hash = supplied_hash;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Invitation is invalid or unavailable';
  end if;

  -- Resolve without a row lock, then acquire locks in the global order:
  -- group first, invitation second.
  perform 1
  from public.groups as target_group
  where target_group.id = candidate_group_id
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Invitation is invalid or unavailable';
  end if;

  select invitation.*
  into locked_invitation
  from public.invitations as invitation
  where invitation.group_id = candidate_group_id
    and invitation.token_hash = supplied_hash
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Invitation is invalid or unavailable';
  end if;

  -- A completed acceptance is retry-safe only for the same verified actor
  -- while that actor still has the matching group membership.
  if locked_invitation.accepted_at is not null then
    if locked_invitation.accepted_by = actor_id
      and locked_invitation.email_normalized = actor_email
      and exists (
        select 1
        from public.memberships as membership
        where membership.group_id = locked_invitation.group_id
          and membership.user_id = actor_id
      )
    then
      return locked_invitation.group_id;
    end if;

    raise exception using
      errcode = '22023',
      message = 'Invitation is invalid or unavailable';
  end if;

  if locked_invitation.revoked_at is not null
    or locked_invitation.expires_at <= pg_catalog.statement_timestamp()
    or locked_invitation.email_normalized <> actor_email
  then
    raise exception using
      errcode = '22023',
      message = 'Invitation is invalid or unavailable';
  end if;

  -- invited_by must still be represented in public.memberships with a
  -- manager role in ('owner', 'admin') for a fresh acceptance.
  if locked_invitation.invited_by is null or not exists (
    select 1
    from public.memberships as issuer_membership
    where issuer_membership.group_id = locked_invitation.group_id
      and issuer_membership.user_id = locked_invitation.invited_by
      and issuer_membership.role in ('owner', 'admin')
  ) then
    raise exception using
      errcode = '22023',
      message = 'Invitation is invalid or unavailable';
  end if;

  insert into public.memberships (group_id, user_id, role)
  values (
    locked_invitation.group_id,
    actor_id,
    locked_invitation.role
  )
  on conflict (group_id, user_id) do nothing;

  update public.invitations
  set
    accepted_at = pg_catalog.statement_timestamp(),
    accepted_by = actor_id,
    updated_at = pg_catalog.statement_timestamp()
  where id = locked_invitation.id;

  return locked_invitation.group_id;
end
$function$;

revoke all on function public.accept_invitation(text) from public;

create or replace function public.revoke_invitation(
  invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  revoked_id uuid;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  update public.invitations as invitation
  set
    revoked_at = pg_catalog.statement_timestamp(),
    updated_at = pg_catalog.statement_timestamp()
  where invitation.id = invitation_id
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and private.has_group_role(
      invitation.group_id,
      array['owner', 'admin']::public.membership_role[]
    )
  returning invitation.id into revoked_id;

  return revoked_id is not null;
end
$function$;

revoke all on function public.revoke_invitation(uuid) from public;

create or replace function public.mark_invitation_delivery_failed(
  invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  failed_invitation_id uuid;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  update public.invitations as invitation
  set
    delivery_state = 'failed',
    updated_at = pg_catalog.statement_timestamp()
  where invitation.id = $1
    and invitation.invited_by = actor_id
    and invitation.delivery_state = 'pending'
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and private.has_group_role(
      invitation.group_id,
      array['owner', 'admin']::public.membership_role[]
    )
  returning invitation.id into failed_invitation_id;

  return failed_invitation_id is not null;
end
$function$;

revoke all on function public.mark_invitation_delivery_failed(uuid)
  from public;

create or replace function public.change_member_role(
  target_group_id uuid,
  member_user_id uuid,
  new_role public.membership_role
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role public.membership_role;
  previous_role public.membership_role;
  owner_count bigint;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select membership.role
  into actor_role
  from public.memberships as membership
  where membership.group_id = target_group_id
    and membership.user_id = actor_id;

  if actor_role is distinct from 'owner' then
    raise exception using
      errcode = '42501',
      message = 'Group owner permission required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = target_group_id
  for update;

  select membership.role
  into actor_role
  from public.memberships as membership
  where membership.group_id = target_group_id
    and membership.user_id = actor_id;

  if actor_role is distinct from 'owner' then
    raise exception using
      errcode = '42501',
      message = 'Group owner permission required';
  end if;

  select membership.role
  into previous_role
  from public.memberships as membership
  where membership.group_id = target_group_id
    and membership.user_id = member_user_id
  for update;

  if not found then
    return false;
  end if;

  if previous_role = 'owner' and new_role <> 'owner' then
    select pg_catalog.count(*)
    into owner_count
    from public.memberships as membership
    where membership.group_id = target_group_id
      and membership.role = 'owner';

    if owner_count <= 1 then
      raise exception using
        errcode = '23514',
        message = 'Cannot demote the last owner';
    end if;
  end if;

  update public.memberships
  set
    role = new_role,
    updated_at = pg_catalog.statement_timestamp()
  where group_id = target_group_id
    and user_id = member_user_id;

  if previous_role in ('owner', 'admin') and new_role = 'member' then
    update public.invitations
    set
      revoked_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
    where group_id = target_group_id
      and invited_by = member_user_id
      and revoked_at is null
      and accepted_at is null;
  end if;

  return true;
end
$function$;

revoke all on function public.change_member_role(
  uuid,
  uuid,
  public.membership_role
) from public;

create or replace function public.remove_member(
  target_group_id uuid,
  member_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := auth.uid();
  actor_role public.membership_role;
  removed_role public.membership_role;
  owner_count bigint;
begin
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  select membership.role
  into actor_role
  from public.memberships as membership
  where membership.group_id = target_group_id
    and membership.user_id = actor_id;

  if actor_role is null then
    raise exception using
      errcode = '42501',
      message = 'Membership removal permission required';
  end if;

  if actor_id <> member_user_id
    and actor_role not in ('owner', 'admin')
  then
    raise exception using
      errcode = '42501',
      message = 'Membership removal permission required';
  end if;

  perform 1
  from public.groups as target_group
  where target_group.id = target_group_id
  for update;

  select membership.role
  into actor_role
  from public.memberships as membership
  where membership.group_id = target_group_id
    and membership.user_id = actor_id;

  if actor_role is null then
    raise exception using
      errcode = '42501',
      message = 'Membership removal permission required';
  end if;

  if actor_id <> member_user_id
    and actor_role not in ('owner', 'admin')
  then
    raise exception using
      errcode = '42501',
      message = 'Membership removal permission required';
  end if;

  select membership.role
  into removed_role
  from public.memberships as membership
  where membership.group_id = target_group_id
    and membership.user_id = member_user_id
  for update;

  if not found then
    return false;
  end if;

  if actor_id <> member_user_id
    and actor_role = 'admin'
    and removed_role <> 'member'
  then
    raise exception using
      errcode = '42501',
      message = 'Membership removal permission required';
  end if;

  if removed_role = 'owner' then
    select pg_catalog.count(*)
    into owner_count
    from public.memberships as membership
    where membership.group_id = target_group_id
      and membership.role = 'owner';

    if owner_count <= 1 then
      raise exception using
        errcode = '23514',
        message = 'Cannot remove the last owner';
    end if;
  end if;

  if removed_role in ('owner', 'admin') then
    update public.invitations
    set
      revoked_at = pg_catalog.statement_timestamp(),
      updated_at = pg_catalog.statement_timestamp()
    where group_id = target_group_id
      and invited_by = member_user_id
      and revoked_at is null
      and accepted_at is null;
  end if;

  delete from public.memberships
  where group_id = target_group_id
    and user_id = member_user_id;

  return true;
end
$function$;

revoke all on function public.remove_member(uuid, uuid) from public;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant select on public.profiles, public.groups, public.memberships
  to authenticated;
grant select (
  id,
  group_id,
  email_normalized,
  invited_by,
  role,
  expires_at,
  revoked_at,
  accepted_at,
  accepted_by,
  delivery_state,
  created_at,
  updated_at
) on public.invitations to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant execute on function private.current_verified_email()
  to authenticated;
grant execute on function private.is_group_member(uuid)
  to authenticated;
grant execute on function private.has_group_role(
  uuid,
  public.membership_role[]
) to authenticated;
grant execute on function private.can_view_profile(uuid)
  to authenticated;

grant execute on function public.create_group(text)
  to authenticated;
grant execute on function public.create_invitation(
  uuid,
  text,
  public.membership_role,
  interval
) to authenticated;
grant execute on function public.accept_invitation(text)
  to authenticated;
grant execute on function public.revoke_invitation(uuid)
  to authenticated;
grant execute on function public.mark_invitation_delivery_failed(uuid)
  to authenticated;
grant execute on function public.change_member_role(
  uuid,
  uuid,
  public.membership_role
) to authenticated;
grant execute on function public.remove_member(uuid, uuid)
  to authenticated;

alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema private
  revoke execute on functions from public;

commit;
