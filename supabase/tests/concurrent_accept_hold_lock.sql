\set ON_ERROR_STOP on

begin;

select target_group.id
from public.groups as target_group
join public.invitations as invitation
  on invitation.group_id = target_group.id
where invitation.token_hash = extensions.digest(
  pg_catalog.convert_to(:'invite_token', 'UTF8'),
  'sha256'
)
for update of target_group;

select pg_catalog.pg_advisory_lock(240724);
select pg_catalog.pg_sleep(3);
select pg_catalog.pg_advisory_unlock(240724);

commit;
