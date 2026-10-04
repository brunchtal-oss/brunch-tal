// Microcopy of the site lock's sign-in form (story 5.9, AD-22): the page
// that the 401 carries for a browser, so an installed app (which shows no
// Basic Auth prompt on iPhone) can still get in. Approved 2026-10-04.

export const siteLockCopy = {
  title: "האתר עדיין סגור.",
  user: "שם משתמש",
  password: "סיסמה",
  submit: "כניסה",
  error: "שם המשתמש או הסיסמה לא נכונים.",
} as const
