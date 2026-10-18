-- Story 3.10, part 1 of 2: the notification type booking_moved and the
-- column bookings.moved_to_booking_id.
--
-- It drops a constraint, so apply_migration through the MCP refuses it: the
-- user runs it in the Supabase SQL Editor (a new, empty query) BEFORE the
-- main migration (move_booking), and the main session registers it in
-- supabase_migrations.schema_migrations.
--
-- Before running: compare the type list below with the live check
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'notification_templates_type_check';
-- and keep every type it has (3.13 or any story merged since may add one).
-- Live on 2026-10-18: the 18 types below without booking_moved.

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
      'card_expiring', 'broadcast', 'admin_card_expiring', 'marketing_reminder'
    ));

-- A booking moved to another session (source section 6). Vars: {from_date}
-- (DD.MM of the session she left), {date} DD.MM and {time} HH:MM of the new
-- session, {concept} its concept's name. Push on, like a confirmation.
insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values (
  'booking_moved', 'customer', true, 'template',
  'ההרשמה הועברה',
  'מ-{from_date} ל-{date} · {time} · בראנץ׳ {concept}',
  array['from_date', 'date', 'time', 'concept']
);

-- The booking a moved (cancelled) booking became. Null for every other
-- booking. Never deleted while referenced.
alter table public.bookings
  add column moved_to_booking_id uuid null
    references public.bookings (id) on delete restrict;

create index bookings_moved_to_booking_id_idx
  on public.bookings (moved_to_booking_id)
  where moved_to_booking_id is not null;
