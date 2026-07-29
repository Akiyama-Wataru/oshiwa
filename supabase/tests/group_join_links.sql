\set ON_ERROR_STOP on

-- Invariants for the one time join link.
--
-- The email invitation binds a circle to one confirmed address. A link binds it
-- to whoever holds the link, so the single use is what keeps the circle closed:
-- a forwarded link is worthless because the first person through burns it.

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '70000000-0000-0000-0000-000000000001',
    'link-owner@example.com',
    pg_catalog.now(),
    '{"display_name":"Owner"}'::jsonb
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    'link-member@example.com',
    pg_catalog.now(),
    '{"display_name":"Member"}'::jsonb
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    'link-first@example.com',
    pg_catalog.now(),
    '{"display_name":"First"}'::jsonb
  ),
  (
    '70000000-0000-0000-0000-000000000004',
    'link-second@example.com',
    pg_catalog.now(),
    '{"display_name":"Second"}'::jsonb
  ),
  -- Somebody who never confirmed their address: with the confirmation step
  -- turned off, this is what an ordinary sign up now looks like.
  (
    '70000000-0000-0000-0000-000000000005',
    'link-unconfirmed@example.com',
    null,
    '{"display_name":"Unconfirmed"}'::jsonb
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000001',
  true
);
select public.create_group('Link Circle') as group_id \gset
reset role;

insert into public.memberships (group_id, user_id, role)
values (
  :'group_id'::uuid,
  '70000000-0000-0000-0000-000000000002',
  'member'
);

select pg_catalog.set_config('test.group_id', :'group_id', true);

-- The raw token is never stored: only its digest, like the invitation token.
do $assert$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'group_join_links'
      and column_name in ('token', 'raw_token', 'link_token', 'secret')
  ) then
    raise exception 'group_join_links keeps a raw token column';
  end if;
end
$assert$;

set role anon;

do $assert$
begin
  begin
    perform pg_catalog.count(*) from public.group_join_links;
    raise exception 'anon unexpectedly selected public.group_join_links';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.create_group_join_link(
      pg_catalog.current_setting('test.group_id')::uuid
    );
    raise exception 'anon unexpectedly created a join link';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

-- A plain member may not hand out the circle.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  begin
    perform public.create_group_join_link(
      pg_catalog.current_setting('test.group_id')::uuid
    );
    raise exception 'a plain member issued a join link';
  exception
    when insufficient_privilege then
      null;
  end;

  -- Neither may somebody outside the circle read the links it has issued.
  if exists (select 1 from public.group_join_links) then
    raise exception 'a plain member read the circle''s join links';
  end if;
end
$assert$;

reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000001',
  true
);

do $assert$
declare
  issued record;
begin
  begin
    perform public.create_group_join_link(
      pg_catalog.current_setting('test.group_id')::uuid,
      'owner'::public.membership_role
    );
    raise exception 'a link handed out ownership';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_group_join_link(
      pg_catalog.current_setting('test.group_id')::uuid,
      'member'::public.membership_role,
      interval '31 days'
    );
    raise exception 'a link outlived the allowed lifetime';
  exception
    when invalid_parameter_value then
      null;
  end;

  select * into issued
  from public.create_group_join_link(
    pg_catalog.current_setting('test.group_id')::uuid
  );

  if issued.link_token !~ '^[0-9a-f]{64}$' then
    raise exception 'the issued token is not 256 bits of hex';
  end if;

  if issued.expires_at <= pg_catalog.statement_timestamp() then
    raise exception 'the issued link was already expired';
  end if;

  perform pg_catalog.set_config('test.link_token', issued.link_token, true);
  perform pg_catalog.set_config('test.link_id', issued.link_id::text, true);
end
$assert$;

reset role;

-- An unknown token and an expired one answer the same way, so neither can be
-- used to learn which circles exist.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000003',
  true
);

do $assert$
begin
  begin
    perform public.accept_group_join_link(pg_catalog.repeat('f', 64));
    raise exception 'an unknown token was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

-- The first person through the link joins.
do $assert$
declare
  joined_group_id uuid;
begin
  joined_group_id := public.accept_group_join_link(
    pg_catalog.current_setting('test.link_token')
  );

  if joined_group_id
    is distinct from pg_catalog.current_setting('test.group_id')::uuid
  then
    raise exception 'the link led to the wrong circle';
  end if;

  if not exists (
    select 1
    from public.memberships as membership
    where membership.group_id = joined_group_id
      and membership.user_id = auth.uid()
      and membership.role = 'member'
  ) then
    raise exception 'the link did not add the member';
  end if;
end
$assert$;

reset role;

-- The second person finds it spent. This is the whole security argument for
-- handing a link around: forwarding it does not carry the circle with it.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000004',
  true
);

do $assert$
begin
  begin
    perform public.accept_group_join_link(
      pg_catalog.current_setting('test.link_token')
    );
    raise exception 'a spent link let a second person in';
  exception
    when invalid_parameter_value then
      null;
  end;

  if exists (
    select 1
    from public.memberships as membership
    where membership.group_id
        = pg_catalog.current_setting('test.group_id')::uuid
      and membership.user_id = auth.uid()
  ) then
    raise exception 'the second person joined anyway';
  end if;
end
$assert$;

reset role;

-- Somebody who is already in the circle does not consume a fresh link by
-- opening it: they are simply already there.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000001',
  true
);
select link_token as second_token
from public.create_group_join_link(:'group_id'::uuid) \gset
reset role;

select pg_catalog.set_config('test.second_token', :'second_token', true);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  joined_group_id uuid;
begin
  joined_group_id := public.accept_group_join_link(
    pg_catalog.current_setting('test.second_token')
  );

  if joined_group_id
    is distinct from pg_catalog.current_setting('test.group_id')::uuid
  then
    raise exception 'an existing member was not told which circle it was';
  end if;
end
$assert$;

reset role;

do $assert$
begin
  if exists (
    select 1
    from public.group_join_links as link
    where link.accepted_at is not null
      and link.accepted_by
        = '70000000-0000-0000-0000-000000000002'::uuid
  ) then
    raise exception 'an existing member burned a link by opening it';
  end if;
end
$assert$;

-- An unconfirmed address is enough to walk through a link. The circle is
-- closed by the link, not by the address, and sign up no longer confirms.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000005',
  true
);

do $assert$
declare
  joined_group_id uuid;
begin
  joined_group_id := public.accept_group_join_link(
    pg_catalog.current_setting('test.second_token')
  );

  if not exists (
    select 1
    from public.memberships as membership
    where membership.group_id = joined_group_id
      and membership.user_id = auth.uid()
  ) then
    raise exception 'a member without a confirmed address could not join';
  end if;
end
$assert$;

reset role;

-- Revoking is a manager's, and it closes the link for good.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000001',
  true
);
select link_token as third_token, link_id as third_id
from public.create_group_join_link(:'group_id'::uuid) \gset
reset role;

select pg_catalog.set_config('test.third_token', :'third_token', true);
select pg_catalog.set_config('test.third_id', :'third_id', true);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  begin
    perform public.revoke_group_join_link(
      pg_catalog.current_setting('test.third_id')::uuid
    );
    raise exception 'a plain member revoked a link';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000001',
  true
);

do $assert$
begin
  if not public.revoke_group_join_link(
    pg_catalog.current_setting('test.third_id')::uuid
  ) then
    raise exception 'the owner could not revoke their own link';
  end if;

  -- Revoking again changes nothing, and says so.
  if public.revoke_group_join_link(
    pg_catalog.current_setting('test.third_id')::uuid
  ) then
    raise exception 'revoking twice reported a second change';
  end if;

  -- A manager can see the circle's links, spent and live alike.
  if not exists (
    select 1
    from public.group_join_links as link
    where link.group_id = pg_catalog.current_setting('test.group_id')::uuid
  ) then
    raise exception 'a manager cannot read their own circle''s links';
  end if;
end
$assert$;

reset role;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000004',
  true
);

do $assert$
begin
  begin
    perform public.accept_group_join_link(
      pg_catalog.current_setting('test.third_token')
    );
    raise exception 'a revoked link still let somebody in';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

reset role;

-- An expired link is refused, and looks exactly like an unknown one.
update public.group_join_links as link
-- created_at moves with it: the table refuses a link that expired before it
-- was made, which is the constraint doing its job.
set
  created_at = pg_catalog.now() - interval '2 hours',
  expires_at = pg_catalog.now() - interval '1 minute'
where link.accepted_at is null and link.revoked_at is null;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000001',
  true
);
select link_token as fresh_token
from public.create_group_join_link(:'group_id'::uuid, 'admin', interval '1 hour') \gset
reset role;

update public.group_join_links as link
-- created_at moves with it: the table refuses a link that expired before it
-- was made, which is the constraint doing its job.
set
  created_at = pg_catalog.now() - interval '2 hours',
  expires_at = pg_catalog.now() - interval '1 minute'
where link.token_hash = extensions.digest(
  pg_catalog.convert_to(:'fresh_token', 'UTF8'),
  'sha256'
);

select pg_catalog.set_config('test.fresh_token', :'fresh_token', true);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '70000000-0000-0000-0000-000000000004',
  true
);

do $assert$
begin
  begin
    perform public.accept_group_join_link(
      pg_catalog.current_setting('test.fresh_token')
    );
    raise exception 'an expired link still let somebody in';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

reset role;

rollback;
