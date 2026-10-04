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
    more: "עוד",
    // The public pages (menu-sheet); also each page's h1 and <title>.
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
    // whatsapp-bar (EXPERIENCE › whatsapp-bar, source §3).
    whatsappLabel: "יצירת קשר",
    whatsappBar: "להצטרפות צרי קשר עם טל",
    whatsappBarName: "להצטרפות צרי קשר עם טל בוואטסאפ (נפתח בוואטסאפ)",
    // The public footer's legal links (its contact lines use contact.*).
    footer: {
      terms: "תנאי שימוש",
      privacy: "מדיניות פרטיות",
      accessibility: "הצהרת נגישות",
    },
    // A public page with no published section yet.
    emptyPage: "התוכן של העמוד הזה עוד בהכנה",
    emptyPageWhatsapp: "לשאלות אפשר לכתוב לטל בוואטסאפ",
    // The name of a section that was published without a title (for screen
    // readers).
    sections: {
      steps: "איך זה עובד",
      faq: "שאלות נפוצות",
      testimonials: "המלצות",
    },
    // The business details (contact page, footer) and home › contact's
    // WhatsApp button.
    contact: {
      label: "פרטי קשר",
      phone: "טלפון",
      whatsappLink: "לכתוב לטל בוואטסאפ",
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
