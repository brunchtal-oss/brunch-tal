// A wa.me link for a phone from the content (contact › business_details).
// The number is put in international format without "+": a local Israeli
// number (0XXXXXXXXX) becomes 972XXXXXXXXX; "+972…" and "00972…" keep their
// digits. Spaces, dashes, dots and parentheses are dropped. Anything that is
// not 8–15 digits after that gives null (no link).
export function whatsappHref(phone: string | null | undefined): string | null {
  if (!phone) return null
  const cleaned = phone.replace(/[\s().-]/g, "")
  let digits: string
  if (/^\+\d+$/.test(cleaned)) digits = cleaned.slice(1)
  else if (/^00\d+$/.test(cleaned)) digits = cleaned.slice(2)
  else if (/^0\d+$/.test(cleaned)) digits = `972${cleaned.slice(1)}`
  else if (/^\d+$/.test(cleaned)) digits = cleaned
  else return null
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null
  return `https://wa.me/${digits}`
}
