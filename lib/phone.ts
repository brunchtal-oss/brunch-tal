// Customer phones are stored as E.164 by private.normalize_phone (AD-9);
// formatLocalPhone formats an Israeli number the way Tal reads it.
// normalizePhone checks and normalizes a phone typed in the site content
// (the business details, the legal pages); it is the content-phone
// counterpart of private.normalize_phone and does not replace it.

const ISRAELI_MOBILE = /^\+972([57]\d)(\d{3})(\d{4})$/
const ISRAELI_LANDLINE = /^\+972([2-489])(\d{3})(\d{4})$/

/**
 * "+972541234567" -> "054-123-4567", "+97231234567" -> "03-123-4567". Any
 * other value (a foreign number, something unexpected) is returned as is.
 */
export function formatLocalPhone(e164: string): string {
  const match = ISRAELI_MOBILE.exec(e164) ?? ISRAELI_LANDLINE.exec(e164)
  if (!match) return e164
  return `0${match[1]}-${match[2]}-${match[3]}`
}

// Invisible direction and width marks that a copied number may carry (a
// number copied from WhatsApp is wrapped in them).
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g
const SEPARATORS = /[\s().\u2010-\u2015\u2212-]/g
// An Israeli number, international, without "+": a mobile or 07x number
// (5 or 7, then 8 digits) or a landline (2, 3, 4, 8 or 9, then 7 digits).
// A number with a digit missing or extra, 1-800/1-700 and any foreign
// number are refused (the business number is a mobile).
const ISRAELI = /^972(?:[57]\d{8}|[2-489]\d{7})$/

/**
 * A content phone in international digits without "+" (972 and the number
 * without its 0), or null when it is not an Israeli number. A local number
 * (0...), with dashes, spaces, dots, parentheses or invisible marks, and
 * "+972", "00972" or "972" before it, with or without the 0 after the 972,
 * all give the same digits. Bare digits without the leading 0 and any
 * foreign number give null (the business is Israeli).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(INVISIBLE, "").replace(SEPARATORS, "")
  let digits: string
  if (/^\+\d+$/.test(cleaned)) digits = cleaned.slice(1)
  else if (/^00\d+$/.test(cleaned)) digits = cleaned.slice(2)
  else if (/^0\d+$/.test(cleaned)) digits = `972${cleaned.slice(1)}`
  else if (/^\d+$/.test(cleaned)) digits = cleaned
  else return null
  if (digits.startsWith("9720")) digits = `972${digits.slice(4)}`
  return ISRAELI.test(digits) ? digits : null
}
