-- The security advisor flags a SECURITY DEFINER function in public that
-- authenticated can execute (lint 0029, WARN). get_my_session_role reads
-- nothing itself: it only calls private.is_admin() and
-- private.current_customer_id(), which are security definer and granted to
-- authenticated. So it runs safely as the caller.
alter function public.get_my_session_role() security invoker;
