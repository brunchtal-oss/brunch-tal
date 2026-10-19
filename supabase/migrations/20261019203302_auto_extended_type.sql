-- Story 3.14, part 1 of 2: the notification type entitlement_auto_extended.
--
-- It drops a constraint, so apply_migration through the MCP refuses it: the
-- user runs it in the Supabase SQL Editor (a new, empty query) BEFORE the
-- main migration (auto_extend inserts the template row), and the main
-- session registers it in supabase_migrations.schema_migrations.
--
-- Before running: compare the type list below with the live check
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'notification_templates_type_check';
-- and keep every type it has (3.16's type, if it was applied first, too).
-- Live on 2026-10-19: the 21 types below without the new one.
--
-- entitlement_auto_extended: a card was extended by a week with no fitting
-- brunch (CAP-36, job_auto_extend).

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
      'entitlement_auto_extended',
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));
