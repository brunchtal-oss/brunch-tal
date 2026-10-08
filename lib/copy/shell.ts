// System microcopy of the three shells (navigation, skip link, sign-out,
// the app top-bar and the notification centers).
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
  // The admin top-bar's link to the public site (user decision 2026-10-06).
  toSite: "מעבר לאתר",
  nav: {
    customerLabel: "ניווט באזור האישי",
    adminLabel: "ניווט בפאנל הניהול",
    footerLabel: "קישורים",
    home: "בית",
    // The admin's sessions tab, one line (user decision 2026-10-08).
    sessions: "בראנצ׳ים",
    // The admin's work tab (story 4.9): the next sessions' work sheets.
    work: "עבודה",
    payments: "תשלומים",
    // The admin's customers (story 4.2), the first row of "more".
    customers: "לקוחות",
    purchases: "היסטוריית רכישות",
    // The customer's sessions tab (user decision 2026-10-06).
    customerSessions: "לו״ז בראנצ׳ים",
    // The customer's last tab (story 2.10, user decision 2026-10-06); the
    // page's h1 is profileTitle.
    profile: "פרופיל",
    profileTitle: "הפרופיל שלי",
    more: "עוד",
    // The public pages (menu-sheet); also each page's h1 and <title>.
    // The public sessions page and its menu item (user decision
    // 2026-10-08; the home page's section keeps its own heading).
    publicSessions: "לו״ז בראנצ׳ים",
    howItWorks: "איך זה עובד ושאלות נפוצות",
    gallery: "גלריה והמלצות",
    contact: "יצירת קשר",
  },
  // The app top-bar of /me and /admin and the notification centers
  // (story 5.7).
  notifications: {
    title: "התראות",
    bell: "התראות",
    bellUnread: (count: string) => `התראות, ${count} שלא נקראו`,
    // The count on the bell: over 99 is "99+".
    overflow: "99+",
    unread: "לא נקראה",
    markRead: "סימון כנקראה",
    markUnread: "סימון כלא נקראה",
    markAllRead: "סימון הכול כנקרא",
    empty: "אין התראות כרגע",
    listLabel: "רשימת ההתראות",
    time: {
      today: (time: string) => `היום, ${time}`,
      yesterday: (time: string) => `אתמול, ${time}`,
    },
    // The push card above the list (story 5.8). The customer's sentence is
    // EXPERIENCE › push explanation; the button wording is the spec's
    // (user decision 2026-10-06). Never names Tal.
    push: {
      label: "התראות במכשיר",
      askCustomer: "רוצה שנזכיר לך לפני הבראנץ׳? נשלח רק דברים שחשובים לך",
      askAdmin: "התראה לטלפון כשמשהו מחכה לטיפול, גם כשהאפליקציה סגורה",
      enable: "כן, להפעיל התראות",
      later: "לא עכשיו",
      on: "התראות פועלות במכשיר הזה",
      turnOff: "לכבות",
      off: "התראות כבויות",
      turnOn: "להפעיל",
      deniedHelp:
        "ההתראות חסומות בדפדפן. כדי להפעיל אותן, צריך לאפשר התראות לאתר בהגדרות המכשיר",
      unsupported:
        "המכשיר או הדפדפן הזה לא תומכים בהתראות. כל ההתראות מחכות לך כאן",
      iosInstall:
        "באייפון התראות מגיעות רק אחרי הוספת האתר למסך הבית. עד אז כל ההתראות מחכות לך כאן",
      iosInstallLink: "איך מוסיפים למסך הבית",
      error: "לא הצלחנו להפעיל התראות במכשיר הזה. אפשר לנסות שוב",
      retry: "לנסות שוב",
    },
  },
  public: {
    customerLogin: "כניסה לאזור האישי",
    // The top-bar and menu link of a signed-in visitor (story 5.7).
    customerArea: "האזור שלי",
    adminArea: "לפאנל הניהול",
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
    // The testimonial carousel's buttons and position dots.
    carousel: {
      previous: "ההמלצה הקודמת",
      next: "ההמלצה הבאה",
      item: (n: number, m: number) => `המלצה ${n} מתוך ${m}`,
      // Instead of the dots when there are many testimonials.
      counter: (n: number, m: number) => `${n} מתוך ${m}`,
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
    // The legal pages (story 5.5). The text itself is published content;
    // only these headings and states are fixed.
    legal: {
      // "DD.MM.YYYY", from the page's last publish.
      updated: (date: string) => `עודכן לאחרונה ${date}`,
      // The links at the bottom of the login page and the profile.
      linksLabel: "מדיניות ונגישות",
      // The accessibility statement: after its text, the fixed heading of
      // the contact for accessibility and its labels.
      accessibility: {
        contact: "פרטי קשר לנגישות",
        contactName: "שם",
        contactPhone: "טלפון",
        contactEmail: "מייל",
        // Before the first publish (EXPERIENCE › State Patterns): the first
        // sentence alone when no contact detail is published.
        soon: "הצהרת הנגישות המלאה תעלה בקרוב.",
        soonContact: "לכל שאלה או בקשה בנושא נגישות:",
        whatsapp: "בוואטסאפ",
      },
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
