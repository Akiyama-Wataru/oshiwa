\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'owner-a@example.com',
    pg_catalog.now(),
    '{"display_name":"Owner A"}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'member-a@example.com',
    pg_catalog.now(),
    '{"display_name":"Member A"}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'owner-b@example.com',
    pg_catalog.now(),
    '{"display_name":"Owner B"}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'admin-a@example.com',
    pg_catalog.now(),
    '{"display_name":"Admin A"}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    'bystander-a@example.com',
    pg_catalog.now(),
    '{"display_name":"Bystander A"}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    'leaver-a@example.com',
    pg_catalog.now(),
    '{"display_name":"Leaver A"}'::jsonb
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);
select public.create_group('Oshi Group A') as group_a_id \gset
reset role;

insert into public.memberships (group_id, user_id, role)
values
  (
    :'group_a_id'::uuid,
    '20000000-0000-0000-0000-000000000002',
    'member'
  ),
  (
    :'group_a_id'::uuid,
    '20000000-0000-0000-0000-000000000004',
    'admin'
  ),
  (
    :'group_a_id'::uuid,
    '20000000-0000-0000-0000-000000000005',
    'member'
  ),
  (
    :'group_a_id'::uuid,
    '20000000-0000-0000-0000-000000000006',
    'member'
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000003',
  true
);
select public.create_group('Oshi Group B') as group_b_id \gset

select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select public.create_oshi(:'group_a_id'::uuid, '  ミナ  ', '#FF6F91')
  as oshi_a1_id \gset
select public.create_oshi(:'group_a_id'::uuid, 'サナ', '#59a5f5')
  as oshi_a2_id \gset

select pg_catalog.set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select public.create_oshi(:'group_b_id'::uuid, 'ジフン', '#7d7bf0')
  as oshi_b1_id \gset
reset role;

select pg_catalog.set_config('test.group_a_id', :'group_a_id', true);
select pg_catalog.set_config('test.group_b_id', :'group_b_id', true);
select pg_catalog.set_config('test.oshi_a1_id', :'oshi_a1_id', true);
select pg_catalog.set_config('test.oshi_a2_id', :'oshi_a2_id', true);
select pg_catalog.set_config('test.oshi_b1_id', :'oshi_b1_id', true);

do $assert$
declare
  stored_name text;
  stored_color text;
begin
  select oshi.name, oshi.member_color
  into stored_name, stored_color
  from public.oshis as oshi
  where oshi.id = pg_catalog.current_setting('test.oshi_a1_id')::uuid;

  if stored_name <> 'ミナ' then
    raise exception 'create_oshi did not trim the display name: %', stored_name;
  end if;

  if stored_color <> '#ff6f91' then
    raise exception 'create_oshi did not normalise the colour: %', stored_color;
  end if;
end
$assert$;

-- Anonymous callers reach neither the table nor the mutation RPCs.
set role anon;

do $assert$
begin
  begin
    perform pg_catalog.count(*) from public.oshis;
    raise exception 'anon unexpectedly selected public.oshis';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.create_oshi(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      'Forbidden',
      '#ffffff'
    );
    raise exception 'anon unexpectedly executed create_oshi';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

reset role;

-- A group member may only mutate through the RPCs: direct table DML stays
-- unreachable in every form.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  begin
    insert into public.oshis (
      group_id,
      name,
      member_color,
      sort_order,
      created_by
    )
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      'Direct Insert',
      '#ffffff',
      99,
      auth.uid()
    );
    raise exception 'member unexpectedly inserted into public.oshis';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    update public.oshis set name = 'Hijacked';
    raise exception 'member unexpectedly updated public.oshis';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    delete from public.oshis;
    raise exception 'member unexpectedly deleted from public.oshis';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- cross-group oshi read: a valid uuid from another group stays invisible.
do $assert$
declare
  visible_count bigint;
begin
  select pg_catalog.count(*) into visible_count from public.oshis;

  if visible_count <> 2 then
    raise exception 'group A member saw % oshis instead of 2', visible_count;
  end if;

  select pg_catalog.count(*)
  into visible_count
  from public.oshis as oshi
  where oshi.id = pg_catalog.current_setting('test.oshi_b1_id')::uuid;

  if visible_count <> 0 then
    raise exception 'group A member read a group B oshi';
  end if;
end
$assert$;

-- cross-group oshi mutation: an outsider cannot edit, delete, or reorder.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000003',
  true
);

do $assert$
begin
  if public.update_oshi(
    pg_catalog.current_setting('test.oshi_a1_id')::uuid,
    'Hijacked',
    '#ffffff'
  ) then
    raise exception 'outsider updated an oshi in another group';
  end if;

  begin
    perform public.delete_oshi(
      pg_catalog.current_setting('test.oshi_a1_id')::uuid
    );
    raise exception 'outsider deleted an oshi in another group';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.set_oshi_image(
      pg_catalog.current_setting('test.oshi_a1_id')::uuid,
      null
    );
    raise exception 'outsider cleared an image in another group';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.reorder_oshis(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      array[pg_catalog.current_setting('test.oshi_a1_id')::uuid]
    );
    raise exception 'outsider reordered another group';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- cross-group image path: an object may only be claimed by its own row.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  spoofed_group_path text :=
    pg_catalog.current_setting('test.group_b_id')
    || '/'
    || pg_catalog.current_setting('test.oshi_a1_id')
    || '/'
    || pg_catalog.repeat('a', 32)
    || '.webp';
  spoofed_oshi_path text :=
    pg_catalog.current_setting('test.group_a_id')
    || '/'
    || pg_catalog.current_setting('test.oshi_a2_id')
    || '/'
    || pg_catalog.repeat('b', 32)
    || '.webp';
begin
  begin
    perform public.set_oshi_image(
      pg_catalog.current_setting('test.oshi_a1_id')::uuid,
      spoofed_group_path
    );
    raise exception 'an image path from another group was accepted';
  exception
    when invalid_parameter_value or check_violation then
      null;
  end;

  begin
    perform public.set_oshi_image(
      pg_catalog.current_setting('test.oshi_a1_id')::uuid,
      spoofed_oshi_path
    );
    raise exception 'an image path from another oshi was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

-- svg rejection: neither the object path nor the bucket accepts a scriptable
-- document.
do $assert$
declare
  svg_path text :=
    pg_catalog.current_setting('test.group_a_id')
    || '/'
    || pg_catalog.current_setting('test.oshi_a1_id')
    || '/'
    || pg_catalog.repeat('a', 32)
    || '.svg';
begin
  begin
    perform public.set_oshi_image(
      pg_catalog.current_setting('test.oshi_a1_id')::uuid,
      svg_path
    );
    raise exception 'an svg object path was accepted';
  exception
    when invalid_parameter_value or check_violation then
      null;
  end;
end
$assert$;

reset role;

do $assert$
declare
  bucket_mime_types text[];
begin
  select bucket.allowed_mime_types
  into bucket_mime_types
  from storage.buckets as bucket
  where bucket.id = 'oshi-images';

  if bucket_mime_types is null
    or 'image/svg+xml' = any (bucket_mime_types)
  then
    raise exception 'the oshi bucket accepts svg uploads';
  end if;

  if bucket_mime_types
    <> array['image/jpeg', 'image/png', 'image/webp']
  then
    raise exception 'the oshi bucket mime allow list drifted';
  end if;
end
$assert$;

-- oversized image rejection is declared on the bucket, next to the privacy
-- flag that keeps objects out of anonymous reach.
do $assert$
declare
  size_limit bigint;
  is_public boolean;
begin
  select bucket.file_size_limit, bucket.public
  into size_limit, is_public
  from storage.buckets as bucket
  where bucket.id = 'oshi-images';

  if size_limit is null or size_limit > 1048576 then
    raise exception 'the oshi bucket size limit is missing or too large: %',
      size_limit;
  end if;

  if is_public then
    raise exception 'the oshi bucket is publicly readable';
  end if;
end
$assert$;

-- per-group quota: the fiftieth oshi is the last one a group may hold.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);
select public.create_group('Quota Group') as quota_group_id \gset
select pg_catalog.set_config('test.quota_group_id', :'quota_group_id', true);

do $assert$
declare
  index integer;
begin
  for index in 1..50 loop
    perform public.create_oshi(
      pg_catalog.current_setting('test.quota_group_id')::uuid,
      'Quota ' || index::text,
      '#123456'
    );
  end loop;

  begin
    perform public.create_oshi(
      pg_catalog.current_setting('test.quota_group_id')::uuid,
      'Quota 51',
      '#123456'
    );
    raise exception 'the per-group oshi quota was exceeded';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

-- member cannot reorder: the display order belongs to the group managers.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);

do $assert$
begin
  begin
    perform public.reorder_oshis(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      array[
        pg_catalog.current_setting('test.oshi_a2_id')::uuid,
        pg_catalog.current_setting('test.oshi_a1_id')::uuid
      ]
    );
    raise exception 'a plain member reordered the group';
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
  '20000000-0000-0000-0000-000000000004',
  true
);

do $assert$
declare
  reordered_count integer;
  leading_oshi_id uuid;
begin
  begin
    perform public.reorder_oshis(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      array[pg_catalog.current_setting('test.oshi_a1_id')::uuid]
    );
    raise exception 'a partial reorder was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.reorder_oshis(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      array[
        pg_catalog.current_setting('test.oshi_a1_id')::uuid,
        pg_catalog.current_setting('test.oshi_b1_id')::uuid
      ]
    );
    raise exception 'a reorder containing another group oshi was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  reordered_count := public.reorder_oshis(
    pg_catalog.current_setting('test.group_a_id')::uuid,
    array[
      pg_catalog.current_setting('test.oshi_a2_id')::uuid,
      pg_catalog.current_setting('test.oshi_a1_id')::uuid
    ]
  );

  if reordered_count <> 2 then
    raise exception 'reorder touched % rows instead of 2', reordered_count;
  end if;

  select oshi.id
  into leading_oshi_id
  from public.oshis as oshi
  where oshi.group_id = pg_catalog.current_setting('test.group_a_id')::uuid
  order by oshi.sort_order
  limit 1;

  if leading_oshi_id
    <> pg_catalog.current_setting('test.oshi_a2_id')::uuid
  then
    raise exception 'the new display order was not applied';
  end if;
end
$assert$;

-- non-owner cannot delete: neither editing nor deleting reaches an oshi that
-- belongs to another member.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000005',
  true
);

do $assert$
begin
  if public.update_oshi(
    pg_catalog.current_setting('test.oshi_a1_id')::uuid,
    'Hijacked',
    '#ffffff'
  ) then
    raise exception 'a bystander edited another member oshi';
  end if;

  begin
    perform public.delete_oshi(
      pg_catalog.current_setting('test.oshi_a1_id')::uuid
    );
    raise exception 'a bystander deleted another member oshi';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- removed member cannot manage: creating an oshi is not a permanent claim, so
-- losing membership has to close every write path to it.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000006',
  true
);
select public.create_oshi(
  pg_catalog.current_setting('test.group_a_id')::uuid,
  'リーバーの推し',
  '#4dd0b1'
) as leaver_oshi_id \gset
select pg_catalog.set_config('test.leaver_oshi_id', :'leaver_oshi_id', true);

reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);
select public.remove_member(
  pg_catalog.current_setting('test.group_a_id')::uuid,
  '20000000-0000-0000-0000-000000000006'
);

reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000006',
  true
);

do $assert$
declare
  stale_path text :=
    pg_catalog.current_setting('test.group_a_id')
    || '/'
    || pg_catalog.current_setting('test.leaver_oshi_id')
    || '/'
    || pg_catalog.repeat('9', 32)
    || '.webp';
begin
  if public.update_oshi(
    pg_catalog.current_setting('test.leaver_oshi_id')::uuid,
    'Hijacked',
    '#ffffff'
  ) then
    raise exception 'a removed member still edited the oshi they created';
  end if;

  begin
    perform public.set_oshi_image(
      pg_catalog.current_setting('test.leaver_oshi_id')::uuid,
      stale_path
    );
    raise exception 'a removed member still attached an image';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.delete_oshi(
      pg_catalog.current_setting('test.leaver_oshi_id')::uuid
    );
    raise exception 'a removed member still deleted the oshi they created';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- orphan cleanup path: replacing or deleting hands the stale object back to
-- the caller so Storage never keeps an unreferenced file.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  first_path text :=
    pg_catalog.current_setting('test.group_a_id')
    || '/'
    || pg_catalog.current_setting('test.oshi_a1_id')
    || '/'
    || pg_catalog.repeat('a', 32)
    || '.webp';
  second_path text :=
    pg_catalog.current_setting('test.group_a_id')
    || '/'
    || pg_catalog.current_setting('test.oshi_a1_id')
    || '/'
    || pg_catalog.repeat('c', 32)
    || '.jpg';
  replaced_path text;
  removed_path text;
begin
  replaced_path := public.set_oshi_image(
    pg_catalog.current_setting('test.oshi_a1_id')::uuid,
    first_path
  );

  if replaced_path is not null then
    raise exception 'the first upload reported a replaced object';
  end if;

  replaced_path := public.set_oshi_image(
    pg_catalog.current_setting('test.oshi_a1_id')::uuid,
    second_path
  );

  if replaced_path is distinct from first_path then
    raise exception 'the replacement did not return the orphaned object';
  end if;

  removed_path := public.delete_oshi(
    pg_catalog.current_setting('test.oshi_a1_id')::uuid
  );

  if removed_path is distinct from second_path then
    raise exception 'the deletion did not return the orphaned object';
  end if;
end
$assert$;

reset role;

insert into storage.objects (bucket_id, name)
values
  (
    'oshi-images',
    :'group_a_id' || '/' || :'oshi_a2_id' || '/'
      || pg_catalog.repeat('d', 32) || '.webp'
  ),
  (
    'oshi-images',
    :'group_b_id' || '/' || :'oshi_b1_id' || '/'
      || pg_catalog.repeat('e', 32) || '.webp'
  );

-- storage policy privileges: PostgreSQL resolves the objects named in a row
-- level security expression against the table's owner, and hosted Supabase
-- gives storage.objects its own owner. If that role cannot reach the private
-- helpers the policies call, every upload is refused with "permission denied
-- for schema private" even though the policy logic itself is correct.
do $assert$
declare
  helper text;
begin
  if not pg_catalog.has_schema_privilege(
    'supabase_storage_admin',
    'private',
    'usage'
  ) then
    raise exception
      'the storage owner cannot use the private schema';
  end if;

  foreach helper in array array[
    'private.is_group_member(uuid)',
    'private.has_group_role(uuid, public.membership_role[])',
    'private.oshi_image_group_id(text)',
    'private.oshi_image_oshi_id(text)',
    'private.can_manage_oshi(uuid)'
  ] loop
    if not pg_catalog.has_function_privilege(
      'supabase_storage_admin',
      helper,
      'execute'
    ) then
      raise exception 'the storage owner cannot execute %', helper;
    end if;
  end loop;
end
$assert$;

-- storage cross-group: a member reads and writes only under their own group
-- prefix, and a malformed object name is refused outright.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  visible_count bigint;
  foreign_path text :=
    pg_catalog.current_setting('test.group_b_id')
    || '/'
    || pg_catalog.current_setting('test.oshi_b1_id')
    || '/'
    || pg_catalog.repeat('f', 32)
    || '.webp';
  unreferenced_path text :=
    pg_catalog.current_setting('test.group_a_id')
    || '/00000000-0000-4000-8000-000000000000/'
    || pg_catalog.repeat('7', 32)
    || '.webp';
begin
  select pg_catalog.count(*) into visible_count from storage.objects;

  if visible_count <> 1 then
    raise exception 'the member saw % storage objects instead of 1',
      visible_count;
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('oshi-images', foreign_path);
    raise exception 'the member wrote under another group prefix';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('oshi-images', 'not-a-scoped-object-name.webp');
    raise exception 'the member wrote a malformed object name';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('oshi-images', unreferenced_path);
    raise exception 'the member parked a file under no oshi at all';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- storage object immutability: there is no update policy, so a rename finds
-- no rows and a plain member cannot delete a shared object.
do $assert$
declare
  changed_count integer;
begin
  update storage.objects set name = name || 'x';
  get diagnostics changed_count = row_count;

  if changed_count <> 0 then
    raise exception 'storage objects were mutable';
  end if;

  delete from storage.objects;
  get diagnostics changed_count = row_count;

  if changed_count <> 0 then
    raise exception 'a plain member deleted a storage object';
  end if;
end
$assert$;

reset role;

rollback;
