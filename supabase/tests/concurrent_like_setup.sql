\set ON_ERROR_STOP on
\set QUIET on

-- Fixture for the two connection like test. Unlike the invariant files this one
-- commits: the other connections have to be able to see it.

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '60000000-0000-0000-0000-000000000001',
    'concurrent-like-author@example.com',
    pg_catalog.now(),
    '{"display_name":"Concurrent Author"}'::jsonb
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    'concurrent-like-fan@example.com',
    pg_catalog.now(),
    '{"display_name":"Concurrent Fan"}'::jsonb
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '60000000-0000-0000-0000-000000000001',
  false
) as configured \gset

select public.create_group('Concurrent Like Circle') as group_id \gset
select public.create_post(:'group_id'::uuid, 'ダブルタップされる投稿') as post_id \gset

reset role;

insert into public.memberships (group_id, user_id, role)
values (
  :'group_id'::uuid,
  '60000000-0000-0000-0000-000000000002',
  'member'
);

\echo :post_id
