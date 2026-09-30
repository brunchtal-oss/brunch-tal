// A link token pasted from a Hebrew message (WhatsApp, a chat, notes) often
// carries invisible direction marks or zero-width characters at its edges,
// and the browser sends them as part of the path (%E2%80%8E...). A real token
// is base64url only, so removing these characters never changes a valid
// token; it only rescues a link that would otherwise read as "expired".
const INVISIBLE = /[\s\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g

export function cleanToken(raw: string): string {
  let value = raw
  // Route params may still be percent-encoded; a malformed escape stays as is
  // and simply fails the token lookup.
  try {
    value = decodeURIComponent(value)
  } catch {
    // keep the raw value
  }
  return value.replace(INVISIBLE, "")
}
