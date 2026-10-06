// System microcopy of the three shells (navigation, skip link, sign-out).
// The wordmark is one constant, the same name as the <title> template. The
// public shell shows the published business name instead when there is one
// (story 5.2).

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
    sessions: "מפגשים",
    payments: "תשלומים",
    purchases: "היסטוריית רכישות",
    // The customer's sessions tab (user decision 2026-10-06); the admin's
    // stays "מפגשים".
    customerSessions: "לו״ז בראנצ׳ים",
    // The customer's last tab (story 2.10, user decision 2026-10-06); the
    // page's h1 is profileTitle.
    profile: "פרופיל",
    profileTitle: "הפרופיל שלי",
    more: "עוד",
    // The public pages (menu-sheet); also each page's h1 and <title>.
    publicSessions: "בראנצ׳ים",
    howItWorks: "איך זה עובד ושאלות נפוצות",
    gallery: "גלריה והמלצות",
    contact: "יצירת קשר",
  },
  public: {
    customerLogin: "כניסה לאזור האישי",
    adminLogin: "כניסת מנהלת",
    // top-bar and menu-sheet (EXPERIENCE › top-bar, menu-sheet).
    menu: "תפריט",
    closeMenu: "סגירת התפריט",
    pagesLabel: "עמודי האתר",
    // whatsapp-bar (EXPERIENCE › whatsapp-bar, source §3; without "עם טל",
    // user decision 2026-10-04: the copy never names Tal).
    whatsappLabel: "יצירת קשר",
    whatsappBar: "להצטרפות צרי קשר",
    whatsappBarName: "להצטרפות צרי קשר בוואטסאפ (נפתח בוואטסאפ)",
    // The public footer's legal links (its contact lines use contact.*).
    footer: {
      terms: "תנאי שימוש",
      privacy: "מדיניות פרטיות",
      accessibility: "הצהרת נגישות",
    },
    // A public page with no published section yet.
    emptyPage: "התוכן של העמוד הזה עוד בהכנה",
    emptyPageWhatsapp: "לשאלות אפשר לפנות בוואטסאפ",
    // The name of a section that was published without a title (for screen
    // readers).
    sections: {
      steps: "איך זה עובד",
      faq: "שאלות נפוצות",
      testimonials: "המלצות",
      gallery: "גלריה",
    },
    // The public session pages and the home page's upcoming sessions
    // (story 5.16, user decision 2026-10-05).
    sessions: {
      upcoming: "הבראנצ׳ים הקרובים",
      all: "לכל הבראנצ׳ים",
      // The guest's action on a session page: "להרשמה התחברי או צרי קשר",
      // "התחברי" to the login page and "צרי קשר" to WhatsApp.
      guestBefore: "להרשמה ",
      guestContact: "צרי קשר",
      guestOr: " או ",
      guestLogin: "התחברי",
    },
    // The business details (contact page, footer) and home › contact's
    // WhatsApp button.
    contact: {
      label: "פרטי קשר",
      phone: "טלפון",
      whatsappLink: "לפנייה בוואטסאפ",
      address: "כתובת",
      arrival: "הוראות הגעה",
      navigation: "פתיחה באפליקציית ניווט",
      opensOutside: "(נפתח בחלון חדש)",
    },
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
    customerOnAdmin: "כניסה לא מורשית",
    goToMe: "לאזור האישי",
  },
} as const
