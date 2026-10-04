// Display only (AD-9). Phones are stored as E.164 by private.normalize_phone;
// this formats an Israeli number the way Tal reads it.

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
