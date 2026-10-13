-- Story 3.8 (user decision 2026-10-13): new default bodies for the business
-- cancel and time-change notices. Titles stay. A template Tal has already
-- edited (its body differs from the old default) is left as it is.

update public.notification_templates
set body = 'אם נרשמת עם כרטיסייה, הכניסה חזרה אלייך. אם שילמת על המפגש בנפרד, ראי פרטים באזור האישי',
    version = version + 1,
    updated_at = now()
where type = 'event_cancelled'
  and body = 'מצטערות על השינוי. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי';

update public.notification_templates
set body = 'לידיעתך! מועד הבראנץ׳ שונה ל-{new_date} בשעה {new_time}',
    version = version + 1,
    updated_at = now()
where type = 'event_changed'
  and body = 'הבראנץ׳ עבר ל{new_date} בשעה {new_time}. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי';
