-- Story 3.14 (phone check, user decision 2026-10-20): the notification is
-- sent after the empty week ended, so its body says "בשבוע שעבר" instead of
-- "השבוע". Only while Tal has not edited the template (the body of
-- 20261019203305_auto_extend.sql); an edited template is left as is.
--
-- Additive: no drop, no grant.

update public.notification_templates
set body = E'לא היו בראנצ׳ים בשבוע שעבר ולכן הארכנו לך את תוקף הכרטיסייה!\nהכרטיסייה שלך בתוקף עד {expires_on}, ונשארו בה {units} כניסות פנויות.',
    version = version + 1,
    updated_at = now(),
    updated_by = null
where type = 'entitlement_auto_extended'
  and body = E'לא היו בראנצ׳ים השבוע ולכן הארכנו לך את תוקף הכרטיסייה!\nהכרטיסייה שלך בתוקף עד {expires_on}, ונשארו בה {units} כניסות פנויות.';
