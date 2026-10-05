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
  // Also the confirm button of both booking sheets; no self-cancel deadline
  // is shown (user decision 2026-10-05, the cancel button comes in 3.6).
  book: "להרשמה",
  registered: "את רשומה למפגש הזה.",
  allSessions: "לכל המפגשים",
  // The booking sheet.
  close: "סגירה",
  uses: "מה ינוצל",
  usesValue: (product: string) => `כניסה אחת מ${product}`,
  remaining: "יישארו",
  remainingValue: (count: number) =>
    count === 0 ? "אין כניסות" : count === 1 ? "כניסה אחת" : `${count} כניסות`,
  validUntilLabel: "בתוקף עד",
  // After the booking (the climax).
  climax: "המקום שלך סביב השולחן שמור",
  toMyBalance: "ליתרה שלי",
  // A pinned purchase whose session has not started (story 3.11): shown
  // instead of the balance card, before the product's message and button.
  pinnedSaved: "המקום שלך שמור",
  // Several dates with a card (story 3.3, wording from the spec's Design
  // Notes).
  selectDates: "לבחור כמה תאריכים",
  selectTitle: "בחירת תאריכים",
  availableEntries: (count: number) =>
    count === 0
      ? "אין כניסות זמינות"
      : count === 1
        ? "כניסה אחת זמינה"
        : `${count} כניסות זמינות`,
  selectedCount: (count: number, max: number) => `נבחרו ${count} מתוך ${max}`,
  continue: "להמשך",
  clearSelection: "ביטול הבחירה",
  // Why a date cannot be chosen, shown in its row.
  unavailableReason: {
    ALREADY_BOOKED: "נרשמת",
    REGISTRATION_CLOSED: "ההרשמה נסגרה",
    EVENT_FULL: "מלא",
    ENTITLEMENT_EXPIRED_ON_DATE: "הכרטיסייה אינה בתוקף ביום הזה",
    other: "לא מתאים לכרטיסייה",
  },
  // The summary sheet.
  selectedDatesTitle: (count: number) =>
    count === 1 ? "התאריך שבחרת" : `${count} התאריכים שבחרת`,
  usesEntries: (count: number, product: string) =>
    count === 1 ? `כניסה אחת מ${product}` : `${count} כניסות מ${product}`,
  // The results, per date.
  saved: "נשמר",
  notSaved: "לא נשמר",
  savedSome: (count: number, total: number) =>
    `שמרנו לך ${count} מתוך ${total} תאריכים`,
  savedNone: "לא הצלחנו לשמור את התאריכים שבחרת",
  entryKept: (dayMonth: string) =>
    `הכניסה של ${dayMonth} לא נוצלה ונשארה ביתרה שלך`,
} as const
