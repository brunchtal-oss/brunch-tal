// Microcopy of the PWA screens (story 5.9): the install guide (/install),
// the offline page (/offline) and the public footer's link to the guide.
// Wording approved by the user 2026-10-04.

export const pwaCopy = {
  install: {
    title: "התקנת האפליקציה",
    intro: "אפשר להוסיף את האתר למסך הבית ולפתוח אותו כמו אפליקציה.",
    installed: "האפליקציה כבר מותקנת במכשיר הזה.",
    android: {
      title: "אנדרואיד",
      button: "התקנת האפליקציה",
      steps: [
        "פתחי את האתר ב-Chrome.",
        "לחצי על התפריט ⋮ בפינה.",
        'בחרי "התקנת אפליקציה" או "הוספה למסך הבית".',
      ],
    },
    iphone: {
      title: "iPhone",
      note: "באייפון, התראות מגיעות רק אחרי הוספה למסך הבית, ב-iOS 16.4 ומעלה.",
      steps: [
        "פתחי את האתר ב-Safari.",
        "לחצי על כפתור השיתוף (ריבוע עם חץ למעלה).",
        'בחרי "הוספה למסך הבית".',
        'לחצי "הוספה". מעכשיו פותחים מהאייקון במסך הבית.',
      ],
    },
  },
  offline: {
    title: "אין חיבור",
    text: "נראה שאין חיבור כרגע. אי אפשר להירשם או לבטל בלי חיבור. כשהחיבור יחזור, אפשר לנסות שוב",
    retry: "לנסות שוב",
  },
  footerLink: "התקנת האפליקציה",
} as const
