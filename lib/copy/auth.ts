// System microcopy for the auth surfaces (/login, /admin/login,
// /reset/[token]).
// Error messages live in lib/errors.ts.

export const authCopy = {
  required: "(חובה)",
  showPassword: "הצגת סיסמה",
  login: {
    title: "התחברות",
    adminTitle: "כניסת מנהלת",
    email: "מייל",
    password: "סיסמה",
    submit: "להתחברות",
    submitting: "מתחברת…",
    forgotPassword: "שכחתי סיסמה",
  },
  // Story 6.11: "forgot password" (/forgot-password). The answer is the
  // same for every address (registered or not, verified or not).
  forgot: {
    title: "שכחתי סיסמה",
    intro: "נשלח קישור לאיפוס סיסמה לכתובת המייל שאיתה את מתחברת.",
    email: "מייל",
    submit: "שליחת קישור לאיפוס",
    submitting: "שולחת…",
    // Two lines, the second on its own line. Each unit is kept whole: a
    // wrap only between units, so the long sentence may break only at its
    // comma (user decision 2026-11-12).
    sent: [
      "אם המייל שלך רשום ומאומת,",
      "שלחנו לך קישור לאיפוס הסיסמה.",
      "לא הגיע? בדקי בספאם.",
    ],
    sentUnverified: "עוד לא אימתת את המייל? צרי קשר.",
    // The phrase in sentUnverified that links to the business WhatsApp.
    contactPhrase: "צרי קשר",
    backToLogin: "חזרה להתחברות",
  },
  // Story 6.11: the link of the verification email (/verify-email). The
  // page only shows a button; the link is used on the press.
  verify: {
    title: "אימות כתובת המייל",
    intro: "כדי לסיים את האימות, לוחצים על הכפתור.",
    submit: "אימות המייל",
    submitting: "מאמתת…",
    done: "כתובת המייל אומתה",
    goToMe: "כניסה לאזור האישי",
    goToAdmin: "כניסה לניהול",
    // Under LINK_INVALID: the way into the personal area, where a new
    // verification email is sent.
    toLogin: "להתחברות",
    // Nobody signed in on this browser: verifying needs the account's own
    // login (user decision 2026-11-11); the login comes back here.
    loginNeeded: "כדי לאמת את המייל צריך להתחבר",
  },
  // Story 6.11: the link of the reset email (/reset-password).
  resetPassword: {
    title: "בחירת סיסמה חדשה",
    submit: "שמירת הסיסמה",
    submitting: "שומרת…",
    linkInvalid: "הקישור לא תקף, כבר נוצל או שפג תוקפו.",
    requestNew: "לבקשת קישור חדש",
  },
  reset: {
    title: "בחירת סיסמה חדשה",
    newPassword: "סיסמה חדשה",
    confirmPassword: "אישור סיסמה",
    passwordHint: "8 תווים לפחות",
    submit: "לשמירת הסיסמה",
    submitting: "שומרת…",
    saved: "הסיסמה החדשה נשמרה",
    goToMe: "כניסה לאזור האישי",
    goToLogin: "להתחברות",
    used: "הקישור הזה כבר שימש לאיפוס סיסמה",
    expired: "תוקף הקישור פג. צרי קשר לקבלת קישור חדש",
    loading: "בודקת את הקישור…",
  },
} as const
