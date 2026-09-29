// System microcopy for the auth surfaces (/login, /reset/[token], /me).
// Error messages live in lib/errors.ts.

export const authCopy = {
  required: "(חובה)",
  showPassword: "הצגת סיסמה",
  login: {
    title: "התחברות",
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
    expired: "תוקף הקישור עבר. טל תשמח לשלוח קישור חדש",
    loading: "בודקת את הקישור…",
  },
  me: {
    title: "האזור האישי",
    greeting: (name: string) => `שלום, ${name}`,
    signOut: "התנתקות",
    loading: "טוען…",
  },
} as const
