begin;

-- PostgreSQL evaluates a table's row level security expressions with the
-- privileges of that table's owner, not the caller's. storage.objects belongs
-- to supabase_storage_admin, so the bucket policies added alongside the
-- oshi-images bucket reach private.* as that role. Without these grants every
-- upload is refused with "permission denied for schema private", while the
-- policies on public.* keep working because postgres owns both those tables
-- and the private schema.
--
-- This widens nothing for members: PostgREST is configured to expose only the
-- public schema, so the helpers below stay unreachable as RPCs, and EXECUTE is
-- still granted function by function rather than across the schema.
do $storage_privileges$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname = 'supabase_storage_admin'
  ) then
    return;
  end if;

  execute 'grant usage on schema private to supabase_storage_admin';
  execute 'grant execute on function private.is_group_member(uuid)
    to supabase_storage_admin';
  execute 'grant execute on function private.has_group_role(
    uuid,
    public.membership_role[]
  ) to supabase_storage_admin';
  execute 'grant execute on function private.oshi_image_group_id(text)
    to supabase_storage_admin';
  execute 'grant execute on function private.oshi_image_oshi_id(text)
    to supabase_storage_admin';
  execute 'grant execute on function private.can_manage_oshi(uuid)
    to supabase_storage_admin';
end
$storage_privileges$;

commit;
