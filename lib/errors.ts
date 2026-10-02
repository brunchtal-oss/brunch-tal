// The only place that maps a stable error code to user-facing microcopy
// (AD-5). SQL raises `raise exception '<CODE>' using errcode = 'P0001'`;
// Server Actions return `{ ok: false, code }`. An unknown code is shown as a
// generic server error.

export const ERROR_MESSAGES = {
  // Raised by RPCs.
  NOT_AUTHORIZED: "אין הרשאה לפעולה הזאת",
  INVALID_INPUT: "חלק מהפרטים לא תקינים",
  LINK_EXPIRED: "תוקף הקישור פג. צרי קשר עם טל לקבלת קישור חדש",
  LINK_USED: "הקישור הזה כבר שימש לאיפוס סיסמה",
  RESET_TARGET_INVALID: "אי אפשר להפיק קישור איפוס לחשבון הזה",
  // The same idempotency key was sent with a different request (AD-5).
  IDEMPOTENCY_KEY_REUSED:
    "הפעולה כבר נשלחה עם פרטים אחרים. כדאי לרענן את הדף ולנסות שוב",
  // Payment approval (story 2.1).
  PRODUCT_NOT_AVAILABLE: "המוצר הזה לא זמין כרגע. בחרי מוצר אחר",
  PINNED_NOT_AVAILABLE: "אישור מוצר למפגש מסוים עוד לא זמין",
  PINNED_EVENT_REQUIRED: "צריך לבחור מפגש למוצר הזה",
  EVENT_NOT_ALLOWED: "למוצר הזה לא בוחרים מפגש",
  PAYMENT_METHOD_NOT_SELECTABLE: "אמצעי התשלום הזה הוסתר. בחרי אחר",
  // A sensitive action was sent without its confirmation (AD-7).
  CONFIRM_REQUIRED: "צריך לאשר את השינוי לפני שממשיכים",
  // Join (story 2.2). INVALID_INPUT of join_begin / join_complete carries
  // detail.field (email | phone | full_name | photo_consent | dietary_notes |
  // babies | baby_name | birth_date) and, for a baby, detail.index.
  CONSENT_REQUIRED: "צריך לאשר את מדיניות הפרטיות כדי להמשיך",
  // User decision 2026-10-02 (round 2); on /join the last phrase links to
  // Tal's WhatsApp.
  LINK_IN_USE: "הלינק מומש. צרי קשר לפרטים נוספים",
  // Raised by private.bind_purchase; the join RPCs turn it into a conflict.
  BIND_CONFLICT: "לא ניתן להוסיף את הרכישה לחשבון. צרי קשר לפרטים נוספים",
  // Raised by the adapter (never by SQL).
  INVALID_CREDENTIALS: "המייל או הסיסמה לא תואמים",
  // Correct password, but no active customer profile and not an admin.
  ACCOUNT_NOT_ACTIVE: "החשבון הזה עוד לא פעיל. אפשר לפנות לטל",
  PASSWORD_TOO_SHORT: "הסיסמה צריכה להיות באורך 8 תווים לפחות",
  PASSWORDS_DONT_MATCH: "הסיסמאות לא תואמות",
  FIELD_REQUIRED: "צריך למלא את השדה הזה",
  SERVER_ERROR: "משהו השתבש. אפשר לנסות שוב בעוד רגע",
} as const

export type ErrorCode = keyof typeof ERROR_MESSAGES

// The machine-readable part of an error (`detail` of the SQL exception):
// which field was refused and, in a list, at which index. Never a value.
export type ErrorDetail = { field?: string; index?: number }

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: ErrorCode; detail?: ErrorDetail }

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_MESSAGES, value)
}

export function errorMessage(code: string): string {
  return isErrorCode(code) ? ERROR_MESSAGES[code] : ERROR_MESSAGES.SERVER_ERROR
}

// PostgREST returns a P0001 exception with the code as `message`.
export function codeFromPostgrestError(
  error: { code?: string; message?: string } | null | undefined
): ErrorCode {
  if (error?.code === "P0001" && isErrorCode(error.message)) {
    return error.message
  }
  return "SERVER_ERROR"
}

// PostgREST returns the exception's DETAIL as `details` (a JSON string in
// our RPCs). Only `field` and `index` are kept.
export function detailFromPostgrestError(
  error: { details?: string | null } | null | undefined
): ErrorDetail | undefined {
  if (!error?.details) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(error.details)
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const { field, index } = parsed as Record<string, unknown>
  const detail: ErrorDetail = {}
  if (typeof field === "string") detail.field = field
  if (Number.isSafeInteger(index)) detail.index = index as number
  return detail.field === undefined && detail.index === undefined
    ? undefined
    : detail
}
