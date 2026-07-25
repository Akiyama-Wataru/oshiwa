\set ON_ERROR_STOP on
\set VERBOSITY verbose

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  :'accept_user_id',
  false
);
select public.accept_invitation(:'invite_token');
