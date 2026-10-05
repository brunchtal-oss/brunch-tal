// System microcopy of the join form (/join/[token], stories 2.2 and 2.3;
// the 2.3 wording was approved by the user on 2026-10-02, round 2 after the
// phone test). The photo
// consent question and its answers are content (content_sections), not here.
// Error codes live in lib/errors.ts; these are the field messages of the form.

export const joinCopy = {
  // A pinned purchase is named by its session, not the product (story 3.11,
  // user decision 2026-10-05). day: "{יום} DD.MM".
  pinnedPurchase: (concept: string, day: string) =>
    `בראנץ׳ ${concept} · ${day}`,
  title: "יצירת החשבון שלך",
  loading: "בודקת את הקישור…",
  fullName: "שם מלא",
  phone: "מספר טלפון",
  email: "כתובת מייל",
  emailHint: "המייל ישמש לכניסה לאזור האישי",
  babyName: "שם התינוק/ת",
  birthDate: "תאריך לידת התינוק/ת",
  addBaby: "+ תינוק נוסף",
  removeBaby: "הסרה",
  dietaryNotes: "אלרגיות והעדפות תזונתיות",
  dietaryPlaceholder:
    "למשל: אלרגיה לאגוזים, צמחונית, טבעונית, ללא גלוטן, לא אוהבת כוסברה",
  password: "סיסמה",
  confirmPassword: "אישור סיסמה",
  privacyConsent: "קראתי ואני מסכימה למדיניות הפרטיות",
  submit: "יצירת החשבון",
  used: "הקישור הזה כבר שימש ליצירת חשבון",
  // Joined, but the sign-in right after it failed.
  joined: "החשבון נוצר. נשאר רק להיכנס לאזור האישי",
  goToLogin: "כניסה לאזור האישי",
  // Inside a message, this phrase is a link to Tal's WhatsApp (plain text
  // when no business details are published).
  contactPhrase: "צרי קשר לפרטים נוספים",
  // The shorter contact phrase of the 2.4 wording (user decision 2026-10-03).
  contactShortPhrase: "צרי קשר",
  // The contact phrase of an expired or revoked link (LINK_EXPIRED).
  expiredContactPhrase: "צרי קשר",
  // two_accounts, attempts 1 and 2 (identity_retry): the form stays.
  identityRetry:
    "לא הצלחנו להשלים את ההרשמה. בדקי שכתובת המייל ומספר הטלפון שהזנת נכונים ונסי שוב או צרי קשר לפרטים נוספים",
  // Auth refused the email; the link stays open for a corrected email (story
  // 2.4). The short contact phrase is the link.
  emailExists:
    "הפרטים קיימים במערכת. בדקי את כתובת המייל ונסי שוב או צרי קשר לפרטים נוספים",
  // A stopped link, by reason; never says which detail matched.
  // too_many_attempts reads like the two_accounts lock (story 2.4).
  conflicts: {
    two_accounts: "יותר מדי נסיונות. הלינק ננעל. צרי קשר לפרטים נוספים.",
    too_many_attempts: "יותר מדי נסיונות. הלינק ננעל. צרי קשר לפרטים נוספים.",
    not_activated: "החשבון לא פעיל. צרי קשר לפרטים נוספים.",
    phone_taken: "הפרטים קיימים במערכת. צרי קשר לפרטים נוספים",
    bind_conflict: "לא ניתן להוסיף את הרכישה לחשבון. צרי קשר לפרטים נוספים",
  },
  // The details belong to an existing account (no page heading on these
  // screens).
  existingAccount: "הפרטים קיימים במערכת. יש להתחבר לחשבון",
  existingAccountLogin: "להתחברות",
  // Before logging in: the details may be a typo; back to an empty form.
  notYourAccount: "לא החשבון שלך?",
  backToForm: "חזרה לטופס",
  // Signed in to that account: confirm before the purchase is added.
  claimNote: "הרכישה תתווסף לחשבונך",
  claimSubmit: "הוספת הרכישה לחשבון שלי",
  claimPending: "מוסיפה…",
  // claim_join refused the account that is signed in.
  otherAccount:
    "אי אפשר להוסיף את הרכישה לחשבון שמחובר עכשיו. צריך להתנתק ולהתחבר לחשבון שלך",
  errorSummary: (count: number) => `יש ${count} שדות לתיקון`,
  errors: {
    phone: "מספר הטלפון לא נראה תקין",
    email: "כתובת המייל לא נראית תקינה",
    birthDate: "תאריך הלידה לא יכול להיות בעתיד",
    photoConsent: "צריך לבחור אחת מהתשובות",
  },
} as const

export type JoinErrorKey = keyof typeof joinCopy.errors
