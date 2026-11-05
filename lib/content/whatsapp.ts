import { normalizePhone } from "@/lib/phone"

// A wa.me link for a phone from the content (contact › business_details).
// The number goes through normalizePhone (lib/phone.ts): international
// digits without "+"; a number that is not Israeli gives null (no link). A
// message (the prepared WhatsApp message of the business details) is added
// as ?text=, encoded; an empty one is left out.
export function whatsappHref(
  phone: string | null | undefined,
  message?: string | null
): string | null {
  const digits = normalizePhone(phone)
  if (!digits) return null
  const text = message?.trim()
  return text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`
}
