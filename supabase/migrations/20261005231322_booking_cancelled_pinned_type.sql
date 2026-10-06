-- Story 3.6: a separate cancellation template for a pinned booking
-- (single, intro, couple), whose entry returns as an entitlement for one of
-- the next sessions. The card case keeps 'booking_cancelled'. Only the type
-- list changes here; the row itself is inserted by the cancel_booking
-- migration. Run in the SQL Editor (drop constraint), not through the MCP.
alter table public.notification_templates
  drop constraint notification_templates_type_check;

alter table public.notification_templates
  add constraint notification_templates_type_check
    check (type in (
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed', 'reminder',
      'waitlist_spot', 'booking_cancelled', 'booking_cancelled_pinned',
      'event_changed', 'event_cancelled', 'entitlement_changed',
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));
