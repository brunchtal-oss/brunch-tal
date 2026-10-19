-- Story 3.13, part 1 of 2: the notification types entitlement_units_changed
-- and entitlement_terms_changed.
--
-- It drops a constraint, so apply_migration through the MCP refuses it: the
-- user runs it in the Supabase SQL Editor (a new, empty query) BEFORE the
-- main migration (entitlement_corrections inserts the template rows), and the
-- main session registers it in supabase_migrations.schema_migrations.
--
-- Before running: compare the type list below with the live check
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'notification_templates_type_check';
-- and keep every type it has (any story applied since may add one).
-- Live on 2026-10-18: the 19 types below without the two new ones
-- (booking_moved came with 3.10, applied to dev the same day).
--
-- entitlement_units_changed: Tal fixed a card's balance.
-- entitlement_terms_changed: Tal changed a card's weekdays or event kind.
-- (entitlement_changed already exists: a card's expiry changed.)

alter table public.notification_templates
  drop constraint notification_templates_type_check;

alter table public.notification_templates
  add constraint notification_templates_type_check
    check (type in (
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed',
      'booking_confirmed_couple', 'booking_moved', 'reminder',
      'waitlist_spot', 'booking_cancelled', 'booking_cancelled_pinned',
      'booking_cancelled_refund', 'refund_completed', 'credit_expiring',
      'event_changed', 'event_cancelled', 'entitlement_changed',
      'entitlement_units_changed', 'entitlement_terms_changed',
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));
