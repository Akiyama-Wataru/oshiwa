\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'test.concurrent_invite_token',
  :'invite_token',
  false
);
select pg_catalog.set_config(
  'test.concurrent_accepted_user_id',
  :'accepted_user_id',
  false
);
select pg_catalog.set_config(
  'test.concurrent_rejected_user_id',
  :'rejected_user_id',
  false
);

do $assert$
declare
  accepted_invitation public.invitations%rowtype;
  accepted_membership_count integer;
begin
  select invitation.*
  into accepted_invitation
  from public.invitations as invitation
  where invitation.token_hash = extensions.digest(
    pg_catalog.convert_to(
      pg_catalog.current_setting('test.concurrent_invite_token'),
      'UTF8'
    ),
    'sha256'
  );

  if not found
    or accepted_invitation.accepted_at is null
    or accepted_invitation.accepted_by <>
      pg_catalog.current_setting(
        'test.concurrent_accepted_user_id'
      )::uuid
  then
    raise exception 'concurrent invitation acceptance state is invalid';
  end if;

  select pg_catalog.count(*)
  into accepted_membership_count
  from public.memberships as membership
  where membership.group_id = accepted_invitation.group_id
    and membership.user_id =
      pg_catalog.current_setting(
        'test.concurrent_accepted_user_id'
      )::uuid
    and membership.role = 'member';

  if accepted_membership_count <> 1 then
    raise exception
      'concurrent acceptance created % matching memberships',
      accepted_membership_count;
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id = accepted_invitation.group_id
      and membership.user_id =
        pg_catalog.current_setting(
          'test.concurrent_rejected_user_id'
        )::uuid
  ) then
    raise exception 'concurrent rejected actor received a membership';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name in ('token', 'raw_token', 'invite_token')
  ) then
    raise exception 'concurrent fixture found a raw token column';
  end if;
end
$assert$;
