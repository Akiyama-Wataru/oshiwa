begin;

-- Phase 2 revoked everything on the private schema and then granted EXECUTE on
-- individual helpers to authenticated. Those grants were unusable: calling a
-- function by qualified name also needs USAGE on its schema, and USAGE was
-- never given back. Nothing noticed, because a policy evaluated as part of a
-- plain query does not re-check these privileges, so every table policy kept
-- working. Supabase Storage evaluates its bucket policies on a path that does
-- check them, and refused all uploads with:
--
--   permission denied for schema private
--
-- USAGE on a schema only makes its contents addressable. It grants no rights
-- of its own: the helpers stay restricted to the individually granted ones,
-- every one of them is SECURITY DEFINER and re-derives auth.uid() internally,
-- and PostgREST is configured to expose only the public schema, so none of
-- them is reachable as an RPC.
grant usage on schema private to authenticated;

commit;
