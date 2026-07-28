\set ON_ERROR_STOP on

select pg_catalog.set_config('test.concurrent_post_id', :'post_id', false);

do $assert$
declare
  like_count bigint;
  notification_count bigint;
begin
  -- The two taps were the same member's, so taking turns can only end one way:
  -- the first records the like, the second withdraws it. Interleaving would
  -- have left either a duplicate or a unique violation on somebody's screen.
  select pg_catalog.count(*)
  into like_count
  from public.post_likes as entry
  where entry.post_id
    = pg_catalog.current_setting('test.concurrent_post_id')::uuid;

  if like_count <> 0 then
    raise exception
      'two concurrent taps left % like rows rather than none',
      like_count;
  end if;

  select pg_catalog.count(*)
  into notification_count
  from public.notifications as notification
  where notification.post_id
      = pg_catalog.current_setting('test.concurrent_post_id')::uuid
    and notification.kind = 'like';

  if notification_count <> 0 then
    raise exception
      'the withdrawn like left % notifications behind',
      notification_count;
  end if;
end
$assert$;
