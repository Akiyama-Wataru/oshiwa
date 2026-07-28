\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '30000000-0000-0000-0000-000000000001',
    'author@example.com',
    pg_catalog.now(),
    '{"display_name":"Author"}'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'reader@example.com',
    pg_catalog.now(),
    '{"display_name":"Reader"}'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    'outsider@example.com',
    pg_catalog.now(),
    '{"display_name":"Outsider"}'::jsonb
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    'admin@example.com',
    pg_catalog.now(),
    '{"display_name":"Admin"}'::jsonb
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);
select public.create_group('Timeline Group') as group_a_id \gset
select public.create_oshi(:'group_a_id'::uuid, 'ミナ', '#ff6f91')
  as oshi_a_id \gset
reset role;

insert into public.memberships (group_id, user_id, role)
values
  (
    :'group_a_id'::uuid,
    '30000000-0000-0000-0000-000000000002',
    'member'
  ),
  (
    :'group_a_id'::uuid,
    '30000000-0000-0000-0000-000000000004',
    'admin'
  );

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000003',
  true
);
select public.create_group('Other Group') as group_b_id \gset
select public.create_oshi(:'group_b_id'::uuid, 'サナ', '#59a5f5')
  as oshi_b_id \gset
reset role;

select pg_catalog.set_config('test.group_a_id', :'group_a_id', true);
select pg_catalog.set_config('test.group_b_id', :'group_b_id', true);
select pg_catalog.set_config('test.oshi_a_id', :'oshi_a_id', true);
select pg_catalog.set_config('test.oshi_b_id', :'oshi_b_id', true);

-- Anonymous callers reach neither the tables nor the mutation RPCs.
set role anon;

do $assert$
begin
  begin
    perform pg_catalog.count(*) from public.posts;
    raise exception 'anon unexpectedly selected public.posts';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.create_post(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      'forbidden'
    );
    raise exception 'anon unexpectedly executed create_post';
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
  '30000000-0000-0000-0000-000000000001',
  true
);

-- direct table DML stays unreachable: posts are written only through the RPCs.
do $assert$
begin
  begin
    insert into public.posts (group_id, author_id, body)
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      auth.uid(),
      'direct insert'
    );
    raise exception 'member unexpectedly inserted into public.posts';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    delete from public.post_hashtags;
    raise exception 'member unexpectedly deleted a hashtag row';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- input boundaries: the body and the association counts are enforced in the
-- database, not only in the form.
do $assert$
declare
  right_to_left_override text := pg_catalog.chr(8238);
begin
  begin
    perform public.create_post(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      '   '
    );
    raise exception 'an empty body was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_post(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      pg_catalog.repeat('あ', 2001)
    );
    raise exception 'an overlong body was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.create_post(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      'gnp' || right_to_left_override || 'exe'
    );
    raise exception 'a bidirectional override was accepted in a body';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

select public.create_post(
  pg_catalog.current_setting('test.group_a_id')::uuid,
  E'一曲目から\nよかった',
  array[pg_catalog.current_setting('test.oshi_a_id')::uuid],
  array['今日の推し', '尊い']
) as post_a_id \gset
select pg_catalog.set_config('test.post_a_id', :'post_a_id', true);

do $assert$
declare
  stored_body text;
  oshi_count bigint;
  tag_count bigint;
begin
  select post.body into stored_body
  from public.posts as post
  where post.id = pg_catalog.current_setting('test.post_a_id')::uuid;

  if stored_body !~ E'\n' then
    raise exception 'the line break in the body was lost';
  end if;

  select pg_catalog.count(*) into oshi_count
  from public.post_oshis as association
  where association.post_id
    = pg_catalog.current_setting('test.post_a_id')::uuid;

  select pg_catalog.count(*) into tag_count
  from public.post_hashtags as hashtag
  where hashtag.post_id
    = pg_catalog.current_setting('test.post_a_id')::uuid;

  if oshi_count <> 1 or tag_count <> 2 then
    raise exception 'associations were not stored: % oshis, % tags',
      oshi_count, tag_count;
  end if;
end
$assert$;

-- parent child group integrity: an oshi from another group cannot be attached,
-- and the composite foreign key makes it unrepresentable even directly.
do $assert$
begin
  begin
    perform public.create_post(
      pg_catalog.current_setting('test.group_a_id')::uuid,
      'cross group reference',
      array[pg_catalog.current_setting('test.oshi_b_id')::uuid]
    );
    raise exception 'an oshi from another group was attached';
  exception
    when invalid_parameter_value then
      null;
  end;
end
$assert$;

reset role;

do $assert$
begin
  begin
    insert into public.post_oshis (group_id, post_id, oshi_id)
    values (
      pg_catalog.current_setting('test.group_a_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.oshi_b_id')::uuid
    );
    raise exception 'the composite foreign key allowed a cross-group oshi';
  exception
    when foreign_key_violation then
      null;
  end;

  begin
    insert into public.post_images (
      group_id,
      post_id,
      sort_order,
      image_path
    )
    values (
      pg_catalog.current_setting('test.group_b_id')::uuid,
      pg_catalog.current_setting('test.post_a_id')::uuid,
      1,
      pg_catalog.current_setting('test.group_b_id')
        || '/'
        || pg_catalog.current_setting('test.post_a_id')
        || '/'
        || pg_catalog.repeat('a', 32)
        || '.webp'
    );
    raise exception 'an image was filed under another group';
  exception
    when foreign_key_violation then
      null;
  end;
end
$assert$;

-- cross-group post read: an outsider sees nothing, by row or by count.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000003',
  true
);

do $assert$
declare
  visible_count bigint;
begin
  select pg_catalog.count(*) into visible_count from public.posts;

  if visible_count <> 0 then
    raise exception 'an outsider saw % posts', visible_count;
  end if;

  select pg_catalog.count(*) into visible_count from public.post_hashtags;

  if visible_count <> 0 then
    raise exception 'an outsider saw % hashtags', visible_count;
  end if;

  if public.update_post(
    pg_catalog.current_setting('test.post_a_id')::uuid,
    'hijacked'
  ) then
    raise exception 'an outsider edited a post in another group';
  end if;

  begin
    perform public.delete_post(
      pg_catalog.current_setting('test.post_a_id')::uuid
    );
    raise exception 'an outsider deleted a post in another group';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- ownership: a fellow member reads the post but never rewrites it.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000002',
  true
);

do $assert$
declare
  visible_count bigint;
begin
  select pg_catalog.count(*) into visible_count from public.posts;

  if visible_count <> 1 then
    raise exception 'a member saw % posts instead of 1', visible_count;
  end if;

  if public.update_post(
    pg_catalog.current_setting('test.post_a_id')::uuid,
    'hijacked by a member'
  ) then
    raise exception 'a member rewrote another member post';
  end if;

  begin
    perform public.attach_post_image(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.group_a_id')
        || '/'
        || pg_catalog.current_setting('test.post_a_id')
        || '/'
        || pg_catalog.repeat('b', 32)
        || '.webp'
    );
    raise exception 'a member attached an image to another member post';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform public.delete_post(
      pg_catalog.current_setting('test.post_a_id')::uuid
    );
    raise exception 'a member deleted another member post';
  exception
    when insufficient_privilege then
      null;
  end;
end
$assert$;

-- moderation: a manager may remove a post they did not write, but still may
-- not rewrite it.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000004',
  true
);

do $assert$
begin
  if public.update_post(
    pg_catalog.current_setting('test.post_a_id')::uuid,
    'rewritten by a manager'
  ) then
    raise exception 'a manager rewrote a post they did not write';
  end if;
end
$assert$;

-- image limit and orphan collection.
reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '30000000-0000-0000-0000-000000000001',
  true
);

do $assert$
declare
  index integer;
  slot smallint;
  orphaned text[];
  prefix text :=
    pg_catalog.current_setting('test.group_a_id')
    || '/'
    || pg_catalog.current_setting('test.post_a_id')
    || '/';
begin
  for index in 1..4 loop
    slot := public.attach_post_image(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      prefix || pg_catalog.repeat(index::text, 32) || '.webp'
    );

    if slot <> index then
      raise exception 'image % landed in slot %', index, slot;
    end if;
  end loop;

  begin
    perform public.attach_post_image(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      prefix || pg_catalog.repeat('c', 32) || '.webp'
    );
    raise exception 'a fifth image was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  begin
    perform public.attach_post_image(
      pg_catalog.current_setting('test.post_a_id')::uuid,
      pg_catalog.current_setting('test.group_b_id')
        || '/'
        || pg_catalog.current_setting('test.post_a_id')
        || '/'
        || pg_catalog.repeat('d', 32)
        || '.webp'
    );
    raise exception 'an image path from another group was accepted';
  exception
    when invalid_parameter_value then
      null;
  end;

  orphaned := public.delete_post(
    pg_catalog.current_setting('test.post_a_id')::uuid
  );

  if pg_catalog.array_length(orphaned, 1) <> 4 then
    raise exception 'deletion returned % orphaned objects instead of 4',
      pg_catalog.array_length(orphaned, 1);
  end if;

  if exists (
    select 1
    from public.post_hashtags as hashtag
    where hashtag.post_id
      = pg_catalog.current_setting('test.post_a_id')::uuid
  ) then
    raise exception 'the hashtags outlived their post';
  end if;
end
$assert$;

reset role;

rollback;
