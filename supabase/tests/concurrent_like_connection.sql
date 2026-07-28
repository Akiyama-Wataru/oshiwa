\set ON_ERROR_STOP on
\set VERBOSITY verbose

set role authenticated;

-- Only the verdict belongs on standard output: the caller compares the two
-- connections' answers, so a stray row would look like one of them.
\o /dev/null
select pg_catalog.set_config('request.jwt.claim.sub', :'like_user_id', false);
\o

select public.toggle_post_like(:'post_id'::uuid) as liked;
