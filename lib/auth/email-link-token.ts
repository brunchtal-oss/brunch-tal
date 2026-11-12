// Story 6.11: the shape of the token in an email link, checked before
// anything is called. Our verification token (/verify-email?token=) is 32
// random bytes in base64url (43 characters); Auth's recovery token_hash
// (/reset-password?token_hash=) is hex. Both fit this. Pure.
export const EMAIL_LINK_TOKEN = /^[A-Za-z0-9_-]{16,255}$/

// The value of a link's form field, trimmed and bounded; "" when missing.
export function emailLinkToken(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().slice(0, 300) : ""
}
