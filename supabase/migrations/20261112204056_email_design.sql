-- Story 6.11 (user decisions 2026-11-12, phone check): the system emails'
-- new look and shorter copy (the subjects stay as they are).
--
-- private.email_html, same name, arguments and result, so `create or
-- replace` (no drop). The order, top to bottom:
--   - an olive band with the business name, like the site's top bar;
--   - the header image: Vault email_image_url (a small JPEG in the public
--     bucket media-public, put there per project by
--     scripts/dev-email-image.mjs / prod-email-image.mjs), read at send time.
--     Missing, or not a public storage URL: the email goes without it.
--     Decorative, so alt="";
--   - the title, one short line, a full-width button sized for a phone (a
--     table cell, so Outlook keeps it) and a small grey note under it. No
--     sentence breaks mid-line (the user's rule, as on the forgot page): the
--     copy is held as units, a sentence or a sentence's part up to its comma
--     or question mark, each in a nowrap span, measured to fit a 320px
--     phone;
--   - a line, the business name as a signature and the site's address. The
--     site's address is the origin of the email's own link, so it follows
--     the Site URL / domain by itself;
--   - at the very bottom, small and grey, the way to copy the link.
-- It now reads Vault, so it is stable (no longer immutable). Its callers
-- (request_email_verification, send_email_hook) are security definer; the
-- grants stay as they are (no role may call it).

create or replace function private.email_html(p_kind text, p_link text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_link text := private.html_escape(p_link);
  v_site text := substring(p_link from '^(https?://[A-Za-z0-9.:\[\]-]+)');
  v_host text;
  v_image text;
  v_title text;
  -- The line and the note as units that never break inside (each a nowrap
  -- span; a wrap only between them). Each unit fits a 320px phone's card.
  v_intro text[];
  v_button text;
  v_note text[];
  v_whole constant text := '<span style="white-space:nowrap">';
  v_name constant text := 'בראנץ׳ אצל טל';
  v_display constant text := 'Heebo,Assistant,Arial,Helvetica,sans-serif';
  v_body constant text := 'Assistant,Arial,Helvetica,sans-serif';
begin
  if p_kind = 'verification' then
    v_title := 'אימות המייל';
    v_intro := array['לוחצים על הכפתור,', 'ובעמוד שנפתח על "אימות המייל".'];
    v_button := 'לאימות המייל';
    v_note := array['הקישור בתוקף לשעה.', 'לא ביקשת? אפשר להתעלם מהמייל.'];
  elsif p_kind = 'reset' then
    v_title := 'איפוס סיסמה';
    v_intro := array['לבחירת סיסמה חדשה,', 'לוחצים על הכפתור.'];
    v_button := 'בחירת סיסמה חדשה';
    v_note := array['הקישור בתוקף לשעה.', 'לא ביקשת? אפשר להתעלם מהמייל.'];
  else
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_host := regexp_replace(coalesce(v_site, ''), '^https?://', '');

  -- Only a public storage URL; anything else leaves the image out.
  select s.decrypted_secret into v_image
  from vault.decrypted_secrets s
  where s.name = 'email_image_url';
  if v_image is null
    or v_image !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/[A-Za-z0-9._/-]+$' then
    v_image := null;
  end if;

  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">'
    || '<meta name="viewport" content="width=device-width, initial-scale=1">'
    || '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">'
    || '<title>' || v_title || '</title></head>'
    || '<body dir="rtl" style="margin:0;padding:0;background-color:#faf6ee;color:#2e2a1f">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#faf6ee"><tr><td align="center" style="padding:24px 12px 32px">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="rtl" style="max-width:560px;background-color:#fffdf8;border:1px solid #e6dfcf;border-radius:14px;overflow:hidden">'
    -- The olive band, like the site's top bar.
    || '<tr><td dir="rtl" bgcolor="#4a4a2a" style="background-color:#4a4a2a;padding:18px 28px;text-align:right;font-family:' || v_display || ';font-size:22px;font-weight:300;line-height:1.2;color:#faf6ee;letter-spacing:0.2px">' || v_name || '</td></tr>'
    -- The header image (decorative).
    || case when v_image is not null then
         '<tr><td style="padding:0;line-height:0;font-size:0"><img src="' || private.html_escape(v_image) || '" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>'
       else '' end
    -- The title, the line, the button and the note under it.
    || '<tr><td dir="rtl" style="padding:36px 28px 32px;text-align:right;font-family:' || v_body || ';font-size:18px;line-height:1.7;color:#2e2a1f">'
    || '<h1 style="margin:0 0 12px;font-family:' || v_display || ';font-size:28px;font-weight:300;line-height:1.25;color:#2e2a1f">' || v_title || '</h1>'
    || '<p style="margin:0 0 28px">' || v_whole || array_to_string(v_intro, '</span> ' || v_whole) || '</span></p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#4a4a2a" style="background-color:#4a4a2a;border-radius:10px">'
    || '<a href="' || v_link || '" style="display:block;padding:17px 24px;font-family:' || v_body || ';font-size:19px;font-weight:600;line-height:1.2;color:#faf6ee;text-decoration:none;text-align:center;border-radius:10px">' || v_button || '</a>'
    || '</td></tr></table>'
    || '<p style="margin:14px 0 0;font-size:15px;line-height:1.6;color:#6b6450">' || v_whole || array_to_string(v_note, '</span> ' || v_whole) || '</span></p>'
    || '</td></tr>'
    -- The signature and the site's address.
    || '<tr><td dir="rtl" style="padding:0 28px 24px;text-align:right">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e6dfcf;padding-top:20px;font-family:' || v_display || ';font-size:18px;font-weight:300;line-height:1.4;color:#2e2a1f">' || v_name || '</td></tr>'
    || case when v_site is not null then
         '<tr><td dir="ltr" style="padding-top:4px;text-align:right;font-family:' || v_body || ';font-size:15px;line-height:1.5"><a href="' || private.html_escape(v_site) || '" style="color:#4a4a2a;text-decoration:underline">' || private.html_escape(v_host) || '</a></td></tr>'
       else '' end
    || '</table></td></tr>'
    -- At the very bottom, small and grey: the link to copy.
    || '<tr><td dir="rtl" style="padding:0 28px 28px;text-align:right;font-family:' || v_body || ';font-size:12px;line-height:1.5;color:#6b6450">'
    || '<p style="margin:0 0 4px">' || v_whole || 'הכפתור לא נפתח?</span> ' || v_whole || 'אפשר להעתיק את הקישור לדפדפן:</span></p>'
    || '<p dir="ltr" style="margin:0;text-align:left;word-break:break-all"><a href="' || v_link || '" style="color:#6b6450">' || v_link || '</a></p>'
    || '</td></tr>'
    || '</table></td></tr></table></body></html>';
end;
$$;

-- AD-5: no role calls it (its callers are security definer).
revoke execute on function private.email_html(text, text) from public, anon, authenticated, service_role;
