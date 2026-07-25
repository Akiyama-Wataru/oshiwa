\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'owner@example.com',
    pg_catalog.now(),
    '{"display_name":"Owner"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'invitee@example.com',
    pg_catalog.now(),
    '{"display_name":"Invitee"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000003',
    'wrong@example.com',
    pg_catalog.now(),
    '{"display_name":"Wrong User"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000004',
    'unverified@example.com',
    null,
    '{"display_name":"Unverified"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000005',
    'revoked-delivery@example.com',
    pg_catalog.now(),
    '{"display_name":"Revoked Invitee"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000006',
    'expired-delivery@example.com',
    pg_catalog.now(),
    '{"display_name":"Expired Invitee"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000007',
    'demoted-issuer-invitee@example.com',
    pg_catalog.now(),
    '{"display_name":"Demoted Issuer Invitee"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000008',
    'removed-issuer-invitee@example.com',
    pg_catalog.now(),
    '{"display_name":"Removed Issuer Invitee"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000009',
    'invitee@example.com',
    pg_catalog.now(),
    '{"display_name":"Replay Actor"}'::jsonb
  );

-- Anonymous callers have neither table access nor mutation RPC access.
set role anon;

do $assert$
begin
  begin
    perform pg_catalog.count(*) from public.groups;
    raise exception 'anon unexpectedly selected a domain table';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.create_group('forbidden');
    raise exception 'anon unexpectedly executed create_group';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

-- The owner creates a group and invitation only through narrow RPCs.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);

select public.create_group('Invariant Group') as group_id \gset

select *
from public.create_invitation(
  :'group_id'::uuid,
  ' Invitee@Example.COM ',
  'member'::public.membership_role,
  interval '1 day'
) \gset

select pg_catalog.set_config('test.group_id', :'group_id', true);
select pg_catalog.set_config(
  'test.invitation_id',
  :'invitation_id',
  true
);
select pg_catalog.set_config('test.invite_token', :'invite_token', true);

select *
from public.create_invitation(
  :'group_id'::uuid,
  'delivery-worker@example.com',
  'member'::public.membership_role,
  interval '1 day'
) \gset delivery_
select pg_catalog.set_config(
  'test.delivery_invitation_id',
  :'delivery_invitation_id',
  true
);

select *
from public.create_invitation(
  :'group_id'::uuid,
  'delivery-failure@example.com',
  'member'::public.membership_role,
  interval '1 day'
) \gset failure_
select pg_catalog.set_config(
  'test.failure_invitation_id',
  :'failure_invitation_id',
  true
);

select *
from public.create_invitation(
  :'group_id'::uuid,
  'revoked-delivery@example.com',
  'member'::public.membership_role,
  interval '1 day'
) \gset revoked_
select pg_catalog.set_config(
  'test.revoked_invitation_id',
  :'revoked_invitation_id',
  true
);
select pg_catalog.set_config(
  'test.revoked_invite_token',
  :'revoked_invite_token',
  true
);

select *
from public.create_invitation(
  :'group_id'::uuid,
  'expired-delivery@example.com',
  'member'::public.membership_role,
  interval '1 day'
) \gset expired_
select pg_catalog.set_config(
  'test.expired_invitation_id',
  :'expired_invitation_id',
  true
);
select pg_catalog.set_config(
  'test.expired_invite_token',
  :'expired_invite_token',
  true
);

-- The delivery failure RPC permits only one pending -> failed transition.
do $assert$
begin
  if not public.mark_invitation_delivery_failed(
    pg_catalog.current_setting('test.failure_invitation_id')::uuid
  ) then
    raise exception 'pending delivery failure RPC transition was rejected';
  end if;

  if public.mark_invitation_delivery_failed(
    pg_catalog.current_setting('test.failure_invitation_id')::uuid
  ) then
    raise exception 'delivery failure RPC transitioned a row twice';
  end if;

  if not public.revoke_invitation(
    pg_catalog.current_setting('test.revoked_invitation_id')::uuid
  ) then
    raise exception 'revoked delivery fixture could not be revoked';
  end if;

  if public.mark_invitation_delivery_failed(
    pg_catalog.current_setting('test.revoked_invitation_id')::uuid
  ) then
    raise exception 'revoked invitation delivery failure was recorded';
  end if;
end
$assert$;

-- An invitation alone does not make an unrelated profile visible.
do $assert$
begin
  if exists (
    select 1
    from public.profiles as profile
    where profile.id = '00000000-0000-0000-0000-000000000002'::uuid
  ) then
    raise exception 'unrelated profile became visible before membership';
  end if;
end
$assert$;

-- Authenticated users cannot bypass RPC validation with direct table DML.
do $assert$
begin
  begin
    insert into public.memberships (group_id, user_id, role)
    values (
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000003',
      'member'
    );
    raise exception 'authenticated direct table DML unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform invitation.token_hash
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.invitation_id')::uuid;
    raise exception 'authenticated caller unexpectedly read token_hash';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    update public.invitations
    set delivery_state = 'sent'
    where id =
      pg_catalog.current_setting('test.delivery_invitation_id')::uuid;
    raise exception 'authenticated delivery_state direct update succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

-- service_role delivery_state update is the intended delivery-worker path.
set role service_role;
do $assert$
begin
  update public.invitations
  set delivery_state = 'sent'
  where id =
    pg_catalog.current_setting('test.delivery_invitation_id')::uuid;

  if not found then
    raise exception 'service_role delivery_state update found no invitation';
  end if;

  update public.invitations
  set
    created_at = pg_catalog.statement_timestamp() - interval '2 days',
    expires_at = pg_catalog.statement_timestamp() - interval '1 day'
  where id =
    pg_catalog.current_setting('test.expired_invitation_id')::uuid;

  if not found then
    raise exception 'expired invitation fixture was not updated';
  end if;
end
$assert$;
reset role;

-- The caller receives a 256-bit raw token once; only its SHA-256 token_hash
-- remains in the database, and the normalized invite email is retained.
do $assert$
begin
  if pg_catalog.length(
    pg_catalog.current_setting('test.invite_token')
  ) <> 64 then
    raise exception 'invite token is not a 32-byte hexadecimal value';
  end if;

  if not exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.invitation_id')::uuid
      and invitation.token_hash = extensions.digest(
        pg_catalog.convert_to(
          pg_catalog.current_setting('test.invite_token'),
          'UTF8'
        ),
        'sha256'
      )
      and invitation.email_normalized = 'invitee@example.com'
      and invitation.delivery_state = 'pending'
  ) then
    raise exception 'stored invitation hash or normalized metadata is invalid';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invitations'
      and column_name in ('token', 'raw_token', 'invite_token')
  ) then
    raise exception 'a raw invitation token column exists';
  end if;

  if not exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.failure_invitation_id')::uuid
      and invitation.delivery_state = 'failed'
      and invitation.accepted_at is null
      and invitation.revoked_at is null
  ) then
    raise exception 'delivery failure RPC persisted an invalid state';
  end if;

  if not exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.revoked_invitation_id')::uuid
      and invitation.delivery_state = 'pending'
      and invitation.revoked_at is not null
  ) then
    raise exception 'revoked delivery fixture state is invalid';
  end if;
end
$assert$;

-- A valid token is still rejected when the verified account email differs.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000003',
  true
);

do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.invite_token')
    );
    raise exception 'wrong verified email unexpectedly accepted invitation';
  exception
    when sqlstate '22023' then
      null;
  end;

  begin
    perform public.remove_member(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    );
    raise exception 'non-member unexpectedly removed a group member';
  exception
    when insufficient_privilege then
      null;
  end;

  -- Missing and existing targets must be indistinguishable to a non-member,
  -- closing the membership-probing side channel.
  begin
    perform public.remove_member(
      pg_catalog.current_setting('test.group_id')::uuid,
      'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
    );
    raise exception 'membership-probing side channel returned target absence';
  exception
    when insufficient_privilege then
      null;
  end;

  -- Existing and missing groups are likewise indistinguishable to a
  -- non-member, closing the role-change group-probing side channel.
  begin
    perform public.change_member_role(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      'member'::public.membership_role
    );
    raise exception 'non-member changed a role in an existing group';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.change_member_role(
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      'member'::public.membership_role
    );
    raise exception 'role-change group-probing side channel revealed absence';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

select public.create_group('Unrelated Group') as other_group_id \gset
select *
from public.create_invitation(
  :'other_group_id'::uuid,
  'unverified@example.com',
  'member'::public.membership_role,
  interval '1 day'
) \gset other_
select pg_catalog.set_config(
  'test.other_group_id',
  :'other_group_id',
  true
);
select pg_catalog.set_config(
  'test.other_invitation_id',
  :'other_invitation_id',
  true
);
select pg_catalog.set_config(
  'test.other_invite_token',
  :'other_invite_token',
  true
);

-- Cross-group RLS hides the first group's rows from the unrelated owner.
do $assert$
begin
  if public.mark_invitation_delivery_failed(
    pg_catalog.current_setting('test.invitation_id')::uuid
  ) then
    raise exception 'cross-group delivery failure was recorded';
  end if;

  if exists (
    select 1
    from public.groups as target_group
    where target_group.id =
      pg_catalog.current_setting('test.group_id')::uuid
  ) then
    raise exception 'cross-group group row leaked';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id =
      pg_catalog.current_setting('test.group_id')::uuid
  ) then
    raise exception 'cross-group memberships leaked';
  end if;

  if exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.invitation_id')::uuid
  ) then
    raise exception 'cross-group invitation leaked';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id in (
      '00000000-0000-0000-0000-000000000001'::uuid,
      '00000000-0000-0000-0000-000000000002'::uuid
    )
  ) then
    raise exception 'cross-group profile leaked';
  end if;
end
$assert$;

-- An unverified matching account is also rejected.
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000004',
  true
);

do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.other_invite_token')
    );
    raise exception 'unverified email unexpectedly accepted invitation';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- Revoked and expired invitations cannot be accepted and create no membership.
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000005',
  true
);
do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.revoked_invite_token')
    );
    raise exception 'revoked invitation unexpectedly accepted';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000006',
  true
);
do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.expired_invite_token')
    );
    raise exception 'expired invitation unexpectedly accepted';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;

reset role;
do $assert$
begin
  if exists (
    select 1
    from public.invitations as invitation
    where invitation.id in (
      pg_catalog.current_setting('test.revoked_invitation_id')::uuid,
      pg_catalog.current_setting('test.expired_invitation_id')::uuid
    )
      and invitation.accepted_at is not null
  ) then
    raise exception 'rejected revoked/expired invitation mutated accepted_at';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.user_id in (
      '00000000-0000-0000-0000-000000000005'::uuid,
      '00000000-0000-0000-0000-000000000006'::uuid
    )
  ) then
    raise exception 'rejected revoked/expired invitation created membership';
  end if;
end
$assert$;

-- The verified invitee accepts once, and a same-actor retry returns the
-- original group without creating another membership.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);
select public.accept_invitation(
  pg_catalog.current_setting('test.invite_token')
);

do $assert$
declare
  retried_group_id uuid;
begin
  retried_group_id := public.accept_invitation(
    pg_catalog.current_setting('test.invite_token')
  );

  if retried_group_id <>
    pg_catalog.current_setting('test.group_id')::uuid
  then
    raise exception 'same-actor retry returned the wrong group';
  end if;
end
$assert$;

-- Even an account with the same verified email cannot replay a token accepted
-- by another actor.
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000009',
  true
);
do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.invite_token')
    );
    raise exception 'other-actor replay unexpectedly succeeded';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;

reset role;

do $assert$
begin
  if not exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.invitation_id')::uuid
      and invitation.accepted_at is not null
      and invitation.accepted_by =
        '00000000-0000-0000-0000-000000000002'::uuid
  ) then
    raise exception 'accepted_at/accepted_by were not recorded';
  end if;

  if not exists (
    select 1
    from public.memberships as membership
    where membership.group_id =
      pg_catalog.current_setting('test.group_id')::uuid
      and membership.user_id =
        '00000000-0000-0000-0000-000000000002'::uuid
      and membership.role = 'member'
  ) then
    raise exception 'invited membership was not created';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id =
      pg_catalog.current_setting('test.group_id')::uuid
      and membership.user_id =
        '00000000-0000-0000-0000-000000000009'::uuid
  ) then
    raise exception 'other-actor replay created a membership';
  end if;

end
$assert$;

-- Shared-group profile visibility appears after membership, while unrelated
-- profiles and all cross-group rows stay hidden from the first owner.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);

do $assert$
begin
  if public.mark_invitation_delivery_failed(
    pg_catalog.current_setting('test.invitation_id')::uuid
  ) then
    raise exception 'accepted invitation delivery failure was recorded';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = '00000000-0000-0000-0000-000000000002'::uuid
  ) then
    raise exception 'shared-group profile was not visible';
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = '00000000-0000-0000-0000-000000000003'::uuid
  ) then
    raise exception 'unrelated profile was visible across groups';
  end if;

  if exists (
    select 1
    from public.groups as target_group
    where target_group.id =
      pg_catalog.current_setting('test.other_group_id')::uuid
  ) then
    raise exception 'cross-group group became visible';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id =
      pg_catalog.current_setting('test.other_group_id')::uuid
  ) then
    raise exception 'cross-group memberships became visible';
  end if;

  if exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.other_invitation_id')::uuid
  ) then
    raise exception 'cross-group invitation became visible';
  end if;
end
$assert$;

-- Role-boundary escalation: an admin cannot mint owner invitations, change
-- roles, or remove an owner; a member cannot mutate another member's role.
do $assert$
begin
  if not public.change_member_role(
    pg_catalog.current_setting('test.group_id')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    'admin'::public.membership_role
  ) then
    raise exception 'owner could not promote admin fixture';
  end if;
end
$assert$;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);

select *
from public.create_invitation(
  pg_catalog.current_setting('test.group_id')::uuid,
  'demoted-issuer-invitee@example.com',
  'admin'::public.membership_role,
  interval '1 day'
) \gset demoted_issuer_
select pg_catalog.set_config(
  'test.demoted_issuer_invitation_id',
  :'demoted_issuer_invitation_id',
  true
);
select pg_catalog.set_config(
  'test.demoted_issuer_invite_token',
  :'demoted_issuer_invite_token',
  true
);

do $assert$
begin
  begin
    perform public.create_invitation(
      pg_catalog.current_setting('test.group_id')::uuid,
      'forbidden-owner@example.com',
      'owner'::public.membership_role,
      interval '1 day'
    );
    raise exception 'admin created an owner invitation';
  exception
    when sqlstate '22023' then
      null;
  end;

  begin
    perform public.change_member_role(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      'member'::public.membership_role
    );
    raise exception 'admin changed an owner role';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.remove_member(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    );
    raise exception 'admin removed an owner';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
do $assert$
begin
  if not public.change_member_role(
    pg_catalog.current_setting('test.group_id')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    'member'::public.membership_role
  ) then
    raise exception 'owner could not restore member fixture';
  end if;
end
$assert$;

-- Issuer revocation on demotion is serialized by the group row. A pending
-- invitation minted by that manager is revoked before any fresh acceptance.
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000007',
  true
);
do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.demoted_issuer_invite_token')
    );
    raise exception 'demoted issuer invitation unexpectedly accepted';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;

reset role;
do $assert$
begin
  if not exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.demoted_issuer_invitation_id')::uuid
      and invitation.invited_by =
        '00000000-0000-0000-0000-000000000002'::uuid
      and invitation.revoked_at is not null
      and invitation.accepted_at is null
  ) then
    raise exception 'issuer revocation on demotion was not persisted';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id =
      pg_catalog.current_setting('test.group_id')::uuid
      and membership.user_id =
        '00000000-0000-0000-0000-000000000007'::uuid
  ) then
    raise exception 'demoted issuer invitation created a membership';
  end if;
end
$assert$;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  begin
    perform public.change_member_role(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      'member'::public.membership_role
    );
    raise exception 'member changed an owner role';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.remove_member(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    );
    raise exception 'member removed an owner';
  exception
    when insufficient_privilege then
      null;
  end;

end
$assert$;

-- Issuer revocation also applies when the manager is removed. The owner
-- promotes the fixture again solely to exercise this second transition.
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
do $assert$
begin
  if not public.change_member_role(
    pg_catalog.current_setting('test.group_id')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    'admin'::public.membership_role
  ) then
    raise exception 'owner could not re-promote removal fixture';
  end if;
end
$assert$;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);
select *
from public.create_invitation(
  pg_catalog.current_setting('test.group_id')::uuid,
  'removed-issuer-invitee@example.com',
  'member'::public.membership_role,
  interval '1 day'
) \gset removed_issuer_
select pg_catalog.set_config(
  'test.removed_issuer_invitation_id',
  :'removed_issuer_invitation_id',
  true
);
select pg_catalog.set_config(
  'test.removed_issuer_invite_token',
  :'removed_issuer_invite_token',
  true
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
do $assert$
begin
  if not public.remove_member(
    pg_catalog.current_setting('test.group_id')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  ) then
    raise exception 'owner could not remove manager fixture';
  end if;
end
$assert$;

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000008',
  true
);
do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.removed_issuer_invite_token')
    );
    raise exception 'removed issuer invitation unexpectedly accepted';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;

-- A prior accepted actor also loses retry eligibility after its membership
-- has been removed.
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000002',
  true
);
do $assert$
begin
  begin
    perform public.accept_invitation(
      pg_catalog.current_setting('test.invite_token')
    );
    raise exception 'removed accepted actor unexpectedly retried invitation';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;

reset role;
do $assert$
begin
  if not exists (
    select 1
    from public.invitations as invitation
    where invitation.id =
      pg_catalog.current_setting('test.removed_issuer_invitation_id')::uuid
      and invitation.invited_by =
        '00000000-0000-0000-0000-000000000002'::uuid
      and invitation.revoked_at is not null
      and invitation.accepted_at is null
  ) then
    raise exception 'issuer revocation on removal was not persisted';
  end if;

  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id =
      pg_catalog.current_setting('test.group_id')::uuid
      and membership.user_id in (
        '00000000-0000-0000-0000-000000000002'::uuid,
        '00000000-0000-0000-0000-000000000008'::uuid
      )
  ) then
    raise exception 'removed issuer path retained an invalid membership';
  end if;
end
$assert$;

-- Both removal and demotion protect the last owner.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);

do $assert$
begin
  begin
    perform public.remove_member(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid
    );
    raise exception 'last owner was unexpectedly removed';
  exception
    when check_violation then
      null;
  end;

  begin
    perform public.change_member_role(
      pg_catalog.current_setting('test.group_id')::uuid,
      '00000000-0000-0000-0000-000000000001'::uuid,
      'member'::public.membership_role
    );
    raise exception 'last owner was unexpectedly demoted';
  exception
    when check_violation then
      null;
  end;
end
$assert$;

reset role;

-- Group creation quota: the profile-row lock serializes the total-count check.
insert into public.groups (name, created_by)
select
  'Group quota fixture ' || series.value,
  '00000000-0000-0000-0000-000000000001'::uuid
from pg_catalog.generate_series(1, 19) as series(value);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
do $assert$
begin
  begin
    perform public.create_group('Twenty-first group');
    raise exception 'group creation quota was not enforced';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;
reset role;

-- Hourly invitation quota counts accepted, revoked, failed, and pending rows.
with quota_state as (
  select 20 - pg_catalog.count(*)::integer as needed
  from public.invitations as invitation
  where invitation.invited_by =
    '00000000-0000-0000-0000-000000000001'::uuid
    and invitation.created_at >
      pg_catalog.statement_timestamp() - interval '1 hour'
)
insert into public.invitations (
  group_id,
  email_normalized,
  token_hash,
  invited_by,
  role,
  expires_at
)
select
  pg_catalog.current_setting('test.group_id')::uuid,
  'hourly-quota-' || series.value || '@example.com',
  extensions.digest(
    pg_catalog.convert_to(
      'hourly-invitation-quota-' || series.value,
      'UTF8'
    ),
    'sha256'
  ),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'member'::public.membership_role,
  pg_catalog.statement_timestamp() + interval '1 day'
from quota_state
cross join lateral pg_catalog.generate_series(
  1,
  greatest(quota_state.needed, 0)
) as series(value);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
do $assert$
begin
  begin
    perform public.create_invitation(
      pg_catalog.current_setting('test.group_id')::uuid,
      'hourly-quota-rejected@example.com',
      'member'::public.membership_role,
      interval '1 day'
    );
    raise exception 'hourly invitation quota was not enforced';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;
reset role;

-- Live pending invitation quota is serialized by the group-row lock and is
-- independent of the caller's rolling-hour count.
with quota_state as (
  select 100 - pg_catalog.count(*)::integer as needed
  from public.invitations as invitation
  where invitation.group_id =
      pg_catalog.current_setting('test.other_group_id')::uuid
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > pg_catalog.statement_timestamp()
)
insert into public.invitations (
  group_id,
  email_normalized,
  token_hash,
  invited_by,
  role,
  expires_at
)
select
  pg_catalog.current_setting('test.other_group_id')::uuid,
  'pending-quota-' || series.value || '@example.com',
  extensions.digest(
    pg_catalog.convert_to(
      'live-pending-invitation-quota-' || series.value,
      'UTF8'
    ),
    'sha256'
  ),
  '00000000-0000-0000-0000-000000000001'::uuid,
  'member'::public.membership_role,
  pg_catalog.statement_timestamp() + interval '1 day'
from quota_state
cross join lateral pg_catalog.generate_series(
  1,
  greatest(quota_state.needed, 0)
) as series(value);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000003',
  true
);
do $assert$
begin
  begin
    perform public.create_invitation(
      pg_catalog.current_setting('test.other_group_id')::uuid,
      'pending-quota-rejected@example.com',
      'member'::public.membership_role,
      interval '1 day'
    );
    raise exception 'live pending invitation quota was not enforced';
  exception
    when sqlstate '22023' then
      null;
  end;
end
$assert$;
reset role;

-- Catalog-level guard: exactly seven public mutation functions are present.
do $assert$
declare
  public_rpc_count integer;
begin
  select pg_catalog.count(*)
  into public_rpc_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public';

  if public_rpc_count <> 7 then
    raise exception 'expected 7 public RPCs, found %', public_rpc_count;
  end if;
end
$assert$;

-- Executable catalog checks prevent SECURITY DEFINER/search_path/ACL drift.
do $assert$
declare
  invalid_function_count integer;
  authenticated_public_rpc_count integer;
begin
  select pg_catalog.count(*)
  into invalid_function_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public', 'private')
    and (
      not procedure.prosecdef
      or not exists (
        select 1
        from pg_catalog.unnest(
          coalesce(procedure.proconfig, array[]::text[])
        ) as setting(value)
        where pg_catalog.replace(
          pg_catalog.split_part(setting.value, '=', 2),
          '"',
          ''
        ) = ''
          and setting.value like 'search_path=%'
      )
    );

  if invalid_function_count <> 0 then
    raise exception
      '% app functions lack hardened SECURITY DEFINER/search_path',
      invalid_function_count;
  end if;

  select pg_catalog.count(*)
  into invalid_function_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      procedure.proacl,
      pg_catalog.acldefault('f', procedure.proowner)
    )
  ) as privilege
  where namespace.nspname in ('public', 'private')
    and privilege.grantee = 0
    and privilege.privilege_type = 'EXECUTE';

  if invalid_function_count <> 0 then
    raise exception '% app functions remain executable by PUBLIC',
      invalid_function_count;
  end if;

  select pg_catalog.count(*)
  into invalid_function_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public', 'private')
    and pg_catalog.has_function_privilege(
      'anon',
      procedure.oid,
      'EXECUTE'
    );

  if invalid_function_count <> 0 then
    raise exception '% app functions remain executable by anon',
      invalid_function_count;
  end if;

  select pg_catalog.count(*)
  into authenticated_public_rpc_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and pg_catalog.has_function_privilege(
      'authenticated',
      procedure.oid,
      'EXECUTE'
    );

  if authenticated_public_rpc_count <> 7 then
    raise exception
      'authenticated can execute % public RPCs instead of 7',
      authenticated_public_rpc_count;
  end if;
end
$assert$;

rollback;
