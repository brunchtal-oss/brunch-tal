// The only place that maps a stable error code to user-facing microcopy
// (AD-5). SQL raises `raise exception '<CODE>' using errcode = 'P0001'`;
// Server Actions return `{ ok: false, code }`. An unknown code is shown as a
// generic server error.

export const ERROR_MESSAGES = {
  // Raised by RPCs.
  NOT_AUTHORIZED: "אין הרשאה לפעולה הזאת",
  INVALID_INPUT: "חלק מהפרטים לא תקינים",
  // A page or block that does not exist (content editor, story 5.1).
  NOT_FOUND: "לא מצאנו את מה שחיפשת. כדאי לרענן את הדף",
  LINK_EXPIRED: "תוקף הקישור פג. צרי קשר לקבלת קישור חדש",
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
  // Repeat purchase (story 2.5, wording approved by the user on 2026-10-04).
  // The customer chosen for a payment was removed in the meantime, or the id
  // in the address is not an available customer.
  CUSTOMER_NOT_AVAILABLE: "הלקוחה הזו לא זמינה. בחרי לקוחה אחרת",
  // A similar payment exists and "separate payment" was not checked (or one
  // was created in the meantime; the preview then reloads).
  DUPLICATE_CONFIRM_REQUIRED: "צריך לאשר שזה תשלום נפרד ולא כפילות",
  // Join (story 2.2). INVALID_INPUT of join_begin / join_complete carries
  // detail.field (email | phone | full_name | photo_consent | dietary_notes |
  // babies | baby_name | birth_date) and, for a baby, detail.index.
  CONSENT_REQUIRED: "צריך לאשר את מדיניות הפרטיות כדי להמשיך",
  // User decision 2026-10-02 (round 2); on /join the last phrase links to
  // Tal's WhatsApp.
  LINK_IN_USE: "הלינק מומש. צרי קשר לפרטים נוספים",
  // Revoking or replacing a join link while the customer is in the middle of
  // joining (claiming for less than 15 minutes; story 2.4, user decision
  // 2026-10-03).
  LINK_IN_PROGRESS: "הלקוחה באמצע הצטרפות. אפשר לבטל או להחליף אחרי 15 דקות",
  // Raised by private.bind_purchase; the join RPCs turn it into a conflict.
  BIND_CONFLICT: "לא ניתן להוסיף את הרכישה לחשבון. צרי קשר לפרטים נוספים",
  // Self-booking (story 3.2, wording approved by the user on 2026-10-04). On
  // the session page the screen adds the action (WhatsApp contact or "all
  // sessions") after the text.
  EVENT_NOT_BOOKABLE: "אי אפשר להירשם למפגש הזה",
  REGISTRATION_CLOSED:
    "ההרשמה העצמית למפגש הזה נסגרה. צרי קשר לבדיקת מקום פנוי.",
  ALREADY_BOOKED: "את כבר רשומה למפגש הזה",
  EVENT_FULL: "הבראנץ׳ מלא. ניתן לבחור תאריך אחר",
  ENTITLEMENT_EXPIRED_ON_DATE:
    "הכרטיסייה אינה בתוקף ביום המפגש. אפשר לבחור מפגש מוקדם יותר.",
  NO_MATCHING_ENTITLEMENT:
    "אין לך כרגע כניסה שמתאימה למפגש הזה. ניתן לרכוש כניסה מתאימה",
  // Pinned product approval (story 3.11): the session Tal picked does not
  // take this product or this customer. EVENT_FULL and EVENT_NOT_BOOKABLE
  // keep their wording.
  EVENT_NOT_FIT: "המפגש הזה לא מתאים למוצר. בחרי מפגש אחר",
  CUSTOMER_ALREADY_BOOKED: "הלקוחה כבר רשומה למפגש הזה. בחרי מפגש אחר",
  // Wording approved by the user on 2026-10-05.
  INTRO_NOT_ELIGIBLE: "בראנץ׳ היכרות מיועד רק ללקוחה חדשה",
  // A row changed between the read and the lock (AD-6).
  CONCURRENT_CHANGE: "משהו השתנה בינתיים. כדאי לרענן את הדף ולנסות שוב",
  // Tal changes the time or kind of a session with bookings (story 3.2,
  // until the impact view of 3.8).
  EVENT_HAS_BOOKINGS:
    "יש נרשמות למפגש, ולכן אי אפשר עדיין לשנות מועד או סוג. אפשר לשנות מכסה, תיאור וסגירה",
  // Tal lowers the capacity below the places already taken (story 3.2).
  CAPACITY_BELOW_BOOKED:
    "המכסה נמוכה ממספר המקומות שכבר תפוסים. אפשר להוריד אותה רק עד מספר התפוסים",
  // Images (story 5.4): the file of an image did not reach the drafts; the
  // copy to the public files did not finish (a retry continues it); a
  // session's image that is not published yet.
  MEDIA_NOT_UPLOADED: "העלאת התמונה לא הסתיימה. אפשר להעלות אותה שוב",
  MEDIA_NOT_COPIED: "פרסום התמונה לא הסתיים. אפשר לנסות שוב",
  MEDIA_NOT_PUBLISHED: "התמונה עוד לא פורסמה. אפשר לנסות לשמור שוב",
  // Tal books a customer after the session's end (story 3.4).
  EVENT_ENDED: "המפגש כבר הסתיים",
  // The customer deletes her own last baby (story 2.10, user decision
  // 2026-10-06). INVALID_INPUT of a baby write carries detail.field
  // birth_date (after the local today) or babies (more than 10).
  LAST_BABY: "צריך להשאיר לפחות תינוק אחד בפרופיל",
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
