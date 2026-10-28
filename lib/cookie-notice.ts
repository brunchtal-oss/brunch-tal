// The cookie notice (story 5.23). A device that clicked "הבנתי" keeps the
// time of the click in localStorage under COOKIE_NOTICE_KEY; the notice is
// shown again when the value is missing, does not parse or is older than
// ACK_MAX_AGE_DAYS. Changing the wording does not show it again. Every
// storage access is in try/catch: a failed read shows the notice, a failed
// write still closes it for this page load. The future tracking code (the
// marketing tab) loads only when hasCookieAck() is true.

/** The localStorage key: the ISO time of the click. */
export const COOKIE_NOTICE_KEY = "cookie_notice_ack"

export const ACK_MAX_AGE_DAYS = 365

const DAY_MS = 24 * 60 * 60 * 1000

/** Whether a stored value is a click from the last ACK_MAX_AGE_DAYS. */
export function isAckValid(value: string | null, now: number): boolean {
  if (!value) return false
  const at = Date.parse(value)
  // A time in the future would never expire, so it is not a click.
  if (Number.isNaN(at) || at > now) return false
  return now - at <= ACK_MAX_AGE_DAYS * DAY_MS
}

// A click whose write failed: closed for this page load only.
let ackedThisLoad = false
const listeners = new Set<() => void>()

/** Whether this device clicked "הבנתי" (for the future tracking code). */
export function hasCookieAck(): boolean {
  if (ackedThisLoad) return true
  try {
    return isAckValid(
      window.localStorage.getItem(COOKIE_NOTICE_KEY),
      Date.now()
    )
  } catch {
    return false
  }
}

/** Saves the click and closes the notice, also when the write throws. */
export function saveCookieAck(now: Date = new Date()): void {
  ackedThisLoad = true
  try {
    window.localStorage.setItem(COOKIE_NOTICE_KEY, now.toISOString())
  } catch {
    // Storage blocked or full: closed for this page load only.
  }
  for (const listener of listeners) listener()
}

/** Exported for the test: the click here and the storage event of another tab. */
export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** For the tests: forget a click of this page load. */
export function resetCookieAckForTest(): void {
  ackedThisLoad = false
}

// A one-letter Hebrew prefix the link joins without a space ("לעיין ב" +
// "מדיניות" reads "לעיין במדיניות").
const PREFIXES: readonly string[] = ["ב", "ל", "מ", "ו", "ה", "כ", "ש"]

/** The text between the body and the link: "" after a prefix, else " ". */
export function linkSeparator(body: string): string {
  const words = body.trimEnd().split(/\s+/)
  const last = words[words.length - 1] ?? ""
  return PREFIXES.includes(last) ? "" : " "
}

export type CookieNoticeView = {
  title?: string
  body?: string
  // Shown only when filled and the privacy policy is published.
  linkLabel?: string
}

/**
 * What the site shows of the block: null without a title and a body
 * (no published content, no notice); the link only with a label and a
 * published privacy policy.
 */
export function cookieNoticeView(
  content: { title?: string; body?: string; link_label?: string } | null,
  privacyPublished: boolean
): CookieNoticeView | null {
  const title = content?.title?.trim() || undefined
  const body = content?.body?.trim() || undefined
  if (!title && !body) return null
  const label = content?.link_label?.trim()
  return {
    title,
    body,
    linkLabel: label && privacyPublished ? label : undefined,
  }
}
