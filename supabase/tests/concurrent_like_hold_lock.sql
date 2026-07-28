\set ON_ERROR_STOP on

-- Holds the circle's row so that both taps below arrive while it is taken. That
-- is what forces them to take turns rather than interleave.

begin;

select target_group.id
from public.groups as target_group
join public.posts as post on post.group_id = target_group.id
where post.id = :'post_id'::uuid
for update of target_group;

select pg_catalog.pg_advisory_lock(240728);
select pg_catalog.pg_sleep(3);
select pg_catalog.pg_advisory_unlock(240728);

commit;
