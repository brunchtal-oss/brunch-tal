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
    forgotPasswordHelp: "טל תוודא שזו את ותשלח לך קישור לאיפוס.",
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
