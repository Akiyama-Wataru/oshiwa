\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'concurrent-owner@example.com',
    pg_catalog.now(),
    '{"display_name":"Concurrent Owner"}'::jsonb
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'concurrent-invitee@example.com',
    pg_catalog.now(),
    '{"display_name":"Concurrent Invitee"}'::jsonb
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'concurrent-invitee@example.com',
    pg_catalog.now(),
    '{"display_name":"Concurrent Rival"}'::jsonb
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  false
) as configured \gset

select public.create_group('Concurrent Acceptance Group') as group_id \gset

select *
from public.create_invitation(
  :'group_id'::uuid,
  'concurrent-invitee@example.com',
  'member'::public.membership_role,
  interval '1 day'
) \gset concurrent_

reset role;
\echo :concurrent_invite_token
