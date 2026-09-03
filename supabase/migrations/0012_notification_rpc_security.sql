-- notify_order_event is an internal server-side primitive. It must never be callable
-- directly by normal authenticated clients because it can create event notifications.
revoke execute on function public.notify_order_event(uuid, text, text, text) from authenticated;
revoke execute on function public.notify_order_event(uuid, text, text, text) from anon;
revoke execute on function public.notify_order_event(uuid, text, text, text) from public;

-- Order transition functions are responsible for invoking notify_order_event.
-- Keep the notification table itself user-readable/user-updatable only through
-- the dedicated read-state RPCs established by the messaging hardening migration.
