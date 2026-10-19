-- Story 3.16, part 1 of 2: the notification types credit_options_changed
-- and credit_refund_requested, and the replaced reason 'admin'.
--
-- It drops constraints, so apply_migration through the MCP refuses it: the
-- user runs it in the Supabase SQL Editor (a new, empty query) BEFORE the
-- main migration (credit_adjustments inserts the template rows and writes
-- replaced_reason 'admin'), and the main session registers it in
-- supabase_migrations.schema_migrations.
--
-- Before running: compare both lists below with the live checks
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname in ('notification_templates_type_check',
--                     'credit_options_replaced_reason_check');
-- and keep every value they have (any story applied since, 3.14 for
-- example, may add one). Live on 2026-10-20: the 22 types below without the
-- two new ones, and the four reasons below without 'admin'.
--
-- credit_options_changed: Tal changed (or extended) a credit's alternatives.
-- credit_refund_requested: Tal replaced a credit with a refund request.
-- replaced_reason 'admin': an alternative Tal removed (it never returns).

alter table public.notification_templates
  drop constraint notification_templates_type_check;

alter table public.notification_templates
  add constraint notification_templates_type_check
    check (type in (
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed',
      'booking_confirmed_couple', 'booking_moved', 'reminder',
      'waitlist_spot', 'booking_cancelled', 'booking_cancelled_pinned',
      'booking_cancelled_refund', 'refund_completed', 'credit_expiring',
      'credit_options_changed', 'credit_refund_requested',
      'event_changed', 'event_cancelled', 'entitlement_changed',
      'entitlement_units_changed', 'entitlement_terms_changed',
      'entitlement_auto_extended',
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));

alter table public.credit_options
  drop constraint credit_options_replaced_reason_check;

alter table public.credit_options
  add constraint credit_options_replaced_reason_check
    check (replaced_reason in ('full', 'event_cancelled', 'booked', 'moved', 'admin'));
