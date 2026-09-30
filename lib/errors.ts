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
  // Raised by the adapter (never by SQL).
  INVALID_CREDENTIALS: "המייל או הסיסמה לא תואמים",
  PASSWORD_TOO_SHORT: "הסיסמה צריכה להיות באורך 8 תווים לפחות",
  PASSWORDS_DONT_MATCH: "הסיסמאות לא תואמות",
  FIELD_REQUIRED: "צריך למלא את השדה הזה",
  SERVER_ERROR: "משהו השתבש. אפשר לנסות שוב בעוד רגע",
} as const

export type ErrorCode = keyof typeof ERROR_MESSAGES

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; code: ErrorCode }

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
