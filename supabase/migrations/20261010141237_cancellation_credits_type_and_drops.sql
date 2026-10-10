-- Story 3.7, part 1 of 2: the type check and the drops.
--
-- The user runs this file and 20261010141240_cancellation_credits.sql in
-- the Supabase SQL Editor in one transaction (it drops, and apply_migration
-- through the MCP refuses that); the main session registers both in
-- supabase_migrations.schema_migrations. Between the two, a cancel does not
-- work, hence the single transaction.
--
-- 1. notification_templates.type: booking_cancelled_refund is added (a
--    pinned booking cancelled with a refund request), and credit_expiring
--    for 5.10 (job_expiry_alerts sends it 5 days before a credit's last
--    option closes; its template row and wording come in 5.10, none in
--    3.7).
-- 2. The 3.6 stopgap (a cancelled pinned booking returned as a regular
--    entitlement) is removed: the trigger on publishing, its function, the
--    three returned helpers and the index of waiting entitlements. The 3.6
--    "returned" entitlements stay regular entitlements (user decision
--    2026-10-10).
-- 3. Functions whose signature changes (AD-5: drop then create):
--    admin_cancel_booking (p_choice is added) and private.cancel_core
--    (p_choice is added). The new ones are created by the main migration.

alter table public.notification_templates
  drop constraint notification_templates_type_check;

alter table public.notification_templates
  add constraint notification_templates_type_check
    check (type in (
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed', 'reminder',
      'waitlist_spot', 'booking_cancelled', 'booking_cancelled_pinned',
      'booking_cancelled_refund', 'credit_expiring',
      'event_changed', 'event_cancelled', 'entitlement_changed',
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));

drop trigger events_refresh_returned on public.events;
drop function private.events_refresh_returned();
drop function private.refresh_returned_entitlements();
drop function private.return_pinned_entitlement(uuid, date, uuid, text, text, text);
drop function private.returned_expiry(uuid, date, integer);
drop index public.entitlements_awaiting_sessions_idx;

drop function public.admin_cancel_booking(uuid, boolean, uuid, text);
drop function private.cancel_core(uuid, uuid, text, text, text);
