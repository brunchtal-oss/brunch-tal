// System microcopy of the join form (/join/[token], story 2.2). The photo
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
  conflict: "טל תבדוק את הפרטים ותחזור אלייך",
  errorSummary: (count: number) => `יש ${count} שדות לתיקון`,
  errors: {
    phone: "מספר הטלפון לא נראה תקין",
    email: "כתובת המייל לא נראית תקינה",
    birthDate: "תאריך הלידה לא יכול להיות בעתיד",
    photoConsent: "צריך לבחור אחת מהתשובות",
  },
} as const

export type JoinErrorKey = keyof typeof joinCopy.errors
