-- Story 3.9, part 1 of 2: the notification type refund_completed.
--
-- It drops a constraint, so apply_migration through the MCP refuses it: the
-- user runs it in the Supabase SQL Editor (a new, empty query) BEFORE the
-- main migration (refund_completion inserts the template row), and the main
-- session registers it in supabase_migrations.schema_migrations.
--
-- Before running: compare the type list below with the live check
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'notification_templates_type_check';
-- and keep every type it has (2.8, 4.3 or any story merged since may add
-- one). Live on 2026-10-13: the 17 types below without refund_completed.
--
-- refund_completed: Tal recorded that she paid a refund (push on; user
-- decision 2026-10-13).

alter table public.notification_templates
  drop constraint notification_templates_type_check;

alter table public.notification_templates
  add constraint notification_templates_type_check
    check (type in (
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed',
      'booking_confirmed_couple', 'reminder',
      'waitlist_spot', 'booking_cancelled', 'booking_cancelled_pinned',
      'booking_cancelled_refund', 'refund_completed', 'credit_expiring',
      'event_changed', 'event_cancelled', 'entitlement_changed',
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));
