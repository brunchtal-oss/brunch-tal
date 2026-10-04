// System microcopy of the customer area (/me). The message and button after
// a purchase are product fields (content), not here.

function elapsed(days: number): string {
  if (days % 7 === 0) {
    const weeks = days / 7
    return weeks === 1 ? "עבר שבוע" : `עברו ${weeks} שבועות`
  }
  return days === 1 ? "עבר יום" : `עברו ${days} ימים`
}

export const customerCopy = {
  purchase: "אישור רכישה:",
  purchasedOn: "נרכשה ב-",
  balancesTitle: "הכניסות שלי",
  available: (count: number) => `${count} זמינות`,
  reserved: (count: number) => `${count} משוריינות`,
  validUntil: "בתוקף עד",
  // A card that expired before it was bound (story 2.4, user decision
  // 2026-10-03); the toggletip explains why. Its contact phrase links to
  // Tal's WhatsApp.
  expiredBeforeBound: "תוקף הכרטיסיה פג",
  // The card's validity days: whole weeks in weeks, otherwise in days
  // (story 2.6: Tal may set any number of days).
  expiredBeforeBoundInfo: (days: number) =>
    `${elapsed(days)} מרכישת הכרטיסיה ולכן פג תוקפה. לבירורים צרי קשר`,
  contactPhrase: "צרי קשר",
  sessionsTitle: "מפגשים",
  sessionsSoon: "המפגשים יופיעו כאן בקרוב",
  // Self-booking (story 3.2, wording approved by the user on 2026-10-04).
  // The session title; never a regular/couple label for the customer.
  brunch: "בראנץ׳",
  sessionTitle: (concept: string) => `בראנץ׳ ${concept}`,
  sessionsEmpty: "המפגשים הבאים עוד נרקחים",
  // status-chip: a label, never a number of places.
  availability: {
    available: "יש מקום",
    last_places: "מקומות אחרונים",
    full: "מלא",
  },
  booked: "נרשמת",
  withBabies: { regular: "מגיעות עם התינוקות", couple: "מגיעים עם התינוקות" },
  book: "להרשמה",
  registered: "את רשומה למפגש הזה.",
  cancelUntil: (when: string) => `אפשר לבטל בעצמך עד ${when}`,
  allSessions: "לכל המפגשים",
  // The booking sheet.
  close: "סגירה",
  uses: "מה ינוצל",
  usesValue: (product: string) => `כניסה אחת מ${product}`,
  remaining: "יישארו",
  remainingValue: (count: number) =>
    count === 0 ? "אין כניסות" : count === 1 ? "כניסה אחת" : `${count} כניסות`,
  validUntilLabel: "בתוקף עד",
  confirmBooking: "לשמור לי את המקום",
  // After the booking (the climax).
  climax: "המקום שלך סביב השולחן שמור",
  toMyBalance: "ליתרה שלי",
} as const
