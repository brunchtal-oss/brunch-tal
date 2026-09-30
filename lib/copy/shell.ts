// System microcopy of the three shells (navigation, skip link, sign-out).
// The wordmark is one constant, the same name as the <title> template. In 5.2
// the public wordmark moves to the published business details.

export const WORDMARK = "בראנץ׳ אצל טל"

export const shellCopy = {
  wordmark: WORDMARK,
  titleTemplate: `%s · ${WORDMARK}`,
  skipToMain: "דילוג לתוכן הראשי",
  loading: "טוען…",
  signOut: "התנתקות",
  nav: {
    customerLabel: "ניווט באזור האישי",
    adminLabel: "ניווט בפאנל הניהול",
    footerLabel: "קישורים",
    home: "בית",
    more: "עוד",
  },
  public: {
    customerLogin: "כניסה לאזור האישי",
    adminLogin: "כניסת מנהלת",
  },
  customer: {
    homeTitle: "בית",
    greeting: (name: string) => (name ? `היי ${name}` : "היי"),
  },
  admin: {
    homeTitle: "בית",
    moreTitle: "עוד",
  },
  gate: {
    // Signed in, but not allowed on this login page's area.
    customerOnAdmin: "את מחוברת כלקוחה. הכניסה כאן היא למנהלת בלבד",
    goToMe: "לאזור האישי",
  },
} as const
