-- Story 5.6 (phone check, user decision 2026-10-20): the waitlist_spot body
-- no longer says a matching entry is needed; it keeps that the place is
-- guaranteed only after the booking is confirmed. Only while Tal has not
-- edited the template (the body of 20261001184225_create_notification_core.sql);
-- an edited template is left as is.
--
-- Additive: no drop, no grant.

update public.notification_templates
set body = 'המקום מובטח רק אחרי שההרשמה מאושרת',
    version = version + 1,
    updated_at = now(),
    updated_by = null
where type = 'waitlist_spot'
  and body = 'כדי להירשם צריך כניסה מתאימה, והמקום מובטח רק אחרי שההרשמה מאושרת';
