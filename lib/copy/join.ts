// System microcopy of the join form (/join/[token], stories 2.2 and 2.3;
// the 2.3 wording was approved by the user on 2026-10-02, round 2 after the
// phone test). The photo
// consent question and its answers are content (content_sections), not here.
// Error codes live in lib/errors.ts; these are the field messages of the form.

export const joinCopy = {
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
  // two_accounts, attempts 1 and 2 (identity_retry): the form stays.
  identityRetry:
    "לא הצלחנו להשלים את ההרשמה. בדקי שכתובת המייל ומספר הטלפון שהזנת נכונים ונסי שוב או צרי קשר לפרטים נוספים",
  // A stopped link, by reason; never says which detail matched.
  conflicts: {
    two_accounts: "יותר מדי נסיונות. הלינק ננעל. צרי קשר לפרטים נוספים.",
    not_activated: "החשבון לא פעיל. צרי קשר לפרטים נוספים.",
    phone_taken: "הפרטים קיימים במערכת. צרי קשר לפרטים נוספים",
    email_exists: "הפרטים קיימים במערכת. צרי קשר לפרטים נוספים",
    bind_conflict: "לא ניתן להוסיף את הרכישה לחשבון. צרי קשר לפרטים נוספים",
  },
  // The details belong to an existing account (no page heading on these
  // screens).
  existingAccount: "הפרטים קיימים במערכת. יש להתחבר לחשבון",
  existingAccountLogin: "להתחברות",
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
