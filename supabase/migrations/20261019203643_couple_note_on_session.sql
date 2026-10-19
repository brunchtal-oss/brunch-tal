-- Story 5.21 (fix 7): the companion's dietary note moved from /me/bookings
-- to the session page (/me/sessions/<event>, under the booking). The couple
-- notification points there.
--
-- 1. private.notify_booking_confirmed: re-based on the live definition
--    (pg_get_functiondef, identical to 20261013161248_couple_and_intro.sql);
--    only the couple target changes, to
--    /me/sessions/<event>#booking-<booking> (the note's section id). The
--    regular target, the types, the discriminator and the vars are as
--    before. Notifications already sent keep their old target.
-- 2. The booking_confirmed_couple template: the default body says "בעמוד
--    המפגש" instead of "בהרשמות שלך". Only while Tal has not edited it (the
--    3.5 default body); an edited template is left as is.
--
-- Additive: no drop, no new grant (the function keeps its revoke from
-- 20261013161248; create or replace keeps the privileges).

-- ---------------------------------------------------------------------------
-- 1. The couple target
-- ---------------------------------------------------------------------------

create or replace function private.notify_booking_confirmed(p_booking public.bookings)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_starts_at timestamptz;
  v_concept text;
begin
  select e.starts_at, c.name into v_starts_at, v_concept
  from public.events e
  join public.concepts c on c.id = e.concept_id
  where e.id = p_booking.event_id;

  perform private.enqueue_notification(
    p_booking.customer_id,
    case when p_booking.party_size = 2
      then 'booking_confirmed_couple'
      else 'booking_confirmed'
    end,
    p_booking.id::text,
    jsonb_build_object(
      'date', private.format_day_month((v_starts_at at time zone 'Asia/Jerusalem')::date),
      'time', to_char(v_starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
      'concept', v_concept
    ),
    case when p_booking.party_size = 2
      then '/me/sessions/' || p_booking.event_id::text || '#booking-' || p_booking.id::text
      else '/me/sessions/' || p_booking.event_id::text
    end
  );
end;
$$;

revoke execute on function private.notify_booking_confirmed(public.bookings) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The default template body
-- ---------------------------------------------------------------------------

update public.notification_templates
set body = '{date} · {time} · בראנץ׳ {concept}. אפשר להוסיף בעמוד המפגש הגבלות תזונה או אלרגיות של המלווה'
where type = 'booking_confirmed_couple'
  and body = '{date} · {time} · בראנץ׳ {concept}. אפשר להוסיף בהרשמות שלך הגבלות תזונה או אלרגיות של המלווה';
