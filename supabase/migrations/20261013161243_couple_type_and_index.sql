-- Story 3.5, part 1 of 2: the notification type and the booking index.
--
-- It drops a constraint and an index, so apply_migration through the MCP
-- refuses it: the user runs it in the Supabase SQL Editor (a new, empty
-- query) BEFORE the main migration (couple_and_intro inserts the new
-- template row), and the main session registers it in
-- supabase_migrations.schema_migrations.
--
-- Before running: compare the type list below with the live check
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'notification_templates_type_check';
-- and keep every type it has (3.8 or any story merged since may add one).
-- Live on 2026-10-13: the 16 types below without booking_confirmed_couple.
--
-- 1. notification_templates.type: booking_confirmed_couple is added (a
--    confirmed couple booking: push, and a target on the companion's
--    dietary note in /me/bookings; user decision 2026-10-10).
-- 2. bookings_confirmed_customer_event_uidx: one real booking (confirmed or
--    completed, private.is_real_booking) per customer and session, so the
--    index backs the rule private.bind_purchase checks (a seat cannot be
--    bound to a customer who already took part in that session). Dev had 0
--    violating rows (checked 2026-10-10); check again before running:
--   select customer_id, event_id from public.bookings
--   where status in ('confirmed', 'completed') and customer_id is not null
--   group by 1, 2 having count(*) > 1;

alter table public.notification_templates
  drop constraint notification_templates_type_check;

alter table public.notification_templates
  add constraint notification_templates_type_check
    check (type in (
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed',
      'booking_confirmed_couple', 'reminder',
      'waitlist_spot', 'booking_cancelled', 'booking_cancelled_pinned',
      'booking_cancelled_refund', 'credit_expiring',
      'event_changed', 'event_cancelled', 'entitlement_changed',
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));

drop index public.bookings_confirmed_customer_event_uidx;

-- One real booking per customer and session (AD-6, AD-23).
create unique index bookings_confirmed_customer_event_uidx
  on public.bookings (customer_id, event_id)
  where status in ('confirmed', 'completed') and customer_id is not null;
