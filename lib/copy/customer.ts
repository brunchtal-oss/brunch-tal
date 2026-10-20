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
  // The receipt of each purchase, only in the purchase history (user
  // decision 2026-10-06: no receipt on home): "{₪}  נרכשה {DD.MM}  בתוקף
  // עד {DD.MM}".
  purchasedOn: "נרכשה",
  validUntil: "בתוקף עד",
  // Only while the entitlement is expiring (is_expiring from the server).
  daysLeft: (days: number) =>
    days <= 0 ? "היום האחרון" : days === 1 ? "עוד יום אחד" : `עוד ${days} ימים`,
  expiring: "עומדת לפוג",
  // Home (story 4.12).
  upcomingTitle: "המפגש הקרוב שלי",
  // The later sessions, each a weekday and date linking to its page (user
  // decision 2026-10-06).
  moreUpcomingTitle: "הבראנצ׳ים הקרובים שלי",
  // The active card: entries used and booked, out of all its entries.
  cardTitle: "הכרטיסייה שלי",
  usedOf: (used: number, total: number) => `ניצלת ${used}/${total}`,
  bookedOf: (booked: number, total: number) => `נרשמת ${booked}/${total}`,
  // Beside the number of free entries on home's home-card (design round,
  // the one new label the user approved on 2026-10-07).
  availableEntriesLabel: "כניסות זמינות",
  emptyHomeTitle: "השולחן מחכה לפעם הבאה",
  // Purchase history (story 4.12, user decision 2026-10-06; the tab and
  // the h1 are shellCopy.nav.purchases).
  purchasesEmpty: "עוד אין כאן רכישות",
  backToPurchases: "להיסטוריית הרכישות",
  // The word of an ended purchase, in place of its validity.
  entitlementUsedUp: "נוצלה",
  entitlementExpired: "פגה",
  entitlementCancelled: "בוטלה",
  // The detail screen.
  historyTitle: "יומן תנועות",
  historyEmpty: "עוד אין תנועות",
  // One row per booking in the log, by its current state (user decision
  // 2026-10-08): "{state} · {יום DD.MM}", the session's title under it.
  bookingState: {
    booked: "נרשמת",
    used: "השתתפת",
    cancelled: "ביטלת",
  },
  // A returned non-card entry on home that funds no booking yet (user
  // decision 2026-10-08).
  toBook: "יש להירשם",
  movement: {
    grant: "רכישה",
    opening_balance: "יתרת פתיחה",
    reserve: "שריון",
    release: "שחרור",
    use: "ניצול",
    adjust: "תיקון",
  },
  // A card that expired before it was bound (story 2.4, user decision
  // 2026-10-03); the toggletip explains why. Its contact phrase links to
  // Tal's WhatsApp.
  expiredBeforeBound: "תוקף הכרטיסיה פג",
  // The card's validity days: whole weeks in weeks, otherwise in days
  // (story 2.6: Tal may set any number of days).
  expiredBeforeBoundInfo: (days: number) =>
    `${elapsed(days)} מרכישת הכרטיסיה ולכן פג תוקפה. לבירורים צרי קשר`,
  contactPhrase: "צרי קשר",
  // The button under the self-service closed notice (cancel or move inside
  // the window; user decision 2026-10-18, phone check).
  closedContact: "ליצירת קשר",
  // Also the tab's label (shellCopy.nav.customerSessions, user decision
  // 2026-10-06).
  sessionsTitle: "לו״ז בראנצ׳ים",
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
  // is shown (user decision 2026-10-05; the self-cancel came in 3.6, see
  // cancel below).
  book: "להרשמה",
  registered: "את רשומה למפגש הזה.",
  // A completed session with her booking (story 3.12), after EVENT_COMPLETED.
  attended: "השתתפת במפגש",
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
  // The profile (story 2.10; the tab and the h1 are shellCopy.nav.profile).
  // An empty field shows nothing (but the dietary row); never "טל" in the customer's wording.
  profile: {
    detailsTitle: "הפרטים שלי",
    fullName: "שם מלא",
    dietaryNotes: "אלרגיות והעדפות תזונתיות",
    // The dietary row while empty: it stays shown, so she knows where to
    // add them.
    dietaryNotesEmpty: "לא צוינו. אפשר להוסיף בלחיצה על עריכה",
    phone: "טלפון",
    email: "מייל",
    babiesTitle: "התינוקות שלי",
    babyName: "שם התינוק/ת",
    birthDate: "תאריך לידה",
    // "{name} · {age}"; only the name when there is no age.
    babyLine: (name: string, age: string) => (age ? `${name} · ${age}` : name),
    bornOn: (date: string) => `נולד/ה ב-${date}`,
    addBaby: "+ תינוק נוסף",
    // A row button's visible word, then sr-only text naming what it acts on
    // (its accessible name starts with the visible word, WCAG 2.5.3).
    edit: "עריכה",
    detailsSuffix: " – הפרטים שלי",
    babySuffix: (name: string) => ` – ${name}`,
    deleteBaby: "מחיקה",
    // The delete confirmation's group name.
    deleteBabyOf: (name: string) => `מחיקת ${name}`,
    confirmDelete: (name: string) => `למחוק את ${name} מהפרופיל?`,
    confirmDeleteYes: "כן, למחוק",
    deleting: "מוחקת…",
    save: "שמירה",
    saving: "שומרת…",
    cancel: "ביטול",
    photoTitle: "אישור תמונות",
    // Back from /me/profile/photos (user decision 2026-10-08).
    backToProfile: "לפרופיל",
    saved: "הפרטים נשמרו",
    birthDateFuture: "תאריך הלידה לא יכול להיות בעתיד",
    linksLabel: "עוד באזור האישי",
    // The first row there, to the push card at the top of
    // /me/notifications (story 5.21).
    notificationsRow: "התראות",
    installGuide: "התקנת האפליקציה",
  },
  // Cancellation credits and refund requests (story 3.7, wording from the
  // spec). Home: one line to /me/bookings while she has a credit to book
  // with. Purchase history: the chip of a pinned purchase that became a
  // credit or a refund request.
  homeCredit: "יש לך זיכוי להרשמה",
  // Home: an open refund request (user decision 2026-10-10), the same look.
  homeRefund: "בקשת ההחזר שלך התקבלה",
  creditChip: {
    credit: "הומרה לזיכוי",
    refund: "בקשת החזר",
    // Story 3.9: only after Tal recorded the refund.
    refunded: "הוחזר",
  },
  // /me/bookings: a credit's card ({date}: DD.MM of the cancelled session)
  // with its active options, or the line while it waits; a refund's card.
  // The booking sheet's "מה ינוצל" shows creditTitle too.
  creditTitle: (date: string) => `זיכוי מהמפגש ב-${date}`,
  creditOptions: "אפשר להירשם לאחד מהמפגשים האלה:",
  creditWaiting: "המפגשים המתאימים הבאים יופיעו כאן כשיתפרסמו",
  // Every one of the N options went by unused (user decision 2026-10-10),
  // followed by contactPhrase.
  creditExhausted: "המפגשים החלופיים עברו בלי הרשמה. אפשר לפנות אלינו",
  // The business cancelled the session (story 3.8, user decision
  // 2026-10-10): a card at the top of home and of her bookings until she
  // chooses; the sheet reuses the cancel's two options. No "Tal".
  pendingChoice: {
    chip: "ממתינה לבחירה שלך",
    title: (date: string) => `המפגש ב-${date} בוטל`,
    text: "מה מתאים לך: זיכוי למפגש אחר או החזר כספי?",
    button: "לבחירה",
    confirm: "לאישור הבחירה",
    doneCredit: "הזיכוי מחכה לך בהרשמות שלך",
    doneRefund: "בקשת ההחזר התקבלה",
  },
  refundTitle: (amount: string) => `בקשת החזר של ${amount} התקבלה`,
  refundNote: "נעדכן אותך כשההחזר יבוצע",
  // Story 3.9: a refund Tal recorded, for 14 days after its date (then only
  // the purchase chip remains). Never shown while the request is open.
  refundedChip: "הוחזר",
  refundedTitle: (amount: string) => `ההחזר של ${amount} בוצע`,
  refundedNote: (date: string) => `בתאריך ${date}`,
  // Cancelling a booking (story 3.6). No self-cancel deadline and no "Tal"
  // anywhere (user decision 2026-10-05); the contact phrase is
  // contactPhrase.
  cancel: {
    button: "ביטול ההרשמה",
    returns: "מה יחזור",
    returnsCard: (product: string) => `כניסה אחת ל${product}`,
    // A pinned booking (story 3.7): she chooses; "כן, לבטל" waits for it.
    // n: the credit's number of next sessions (business_settings).
    choiceCredit: "זיכוי למפגש אחר",
    choiceCreditNote: (n: number) =>
      `אפשר להירשם לאחד מ-${n} המפגשים המתאימים הבאים`,
    choiceRefund: "החזר כספי",
    choiceRefundNote: "בקשת ההחזר תגיע אלינו, ונעדכן כשההחזר יבוצע",
    // A booking funded by a credit: the same credit comes back.
    returnsCredit: "הזיכוי יחזור אלייך עם אותן חלופות",
    confirm: "כן, לבטל",
    // Past the self-cancel boundary, on the session page only, followed by
    // the contact phrase (user decision 2026-10-06). The same notice for a
    // tap on cancel or on move (story 3.10). hours: the booking's own cancel
    // window (policy_snapshot), null when it cannot be read.
    closed: (hours: number | null) =>
      hours === null
        ? "לא ניתן לבטל או להזיז עצמאית כל כך קרוב למפגש."
        : `לא ניתן לבטל או להזיז עצמאית פחות מ-${hours} שעות לפני המפגש.`,
    // The result (inline-notice, success).
    doneCard: "ההרשמה בוטלה. הכניסה חזרה ליתרה שלך",
    doneCredit: "ההרשמה בוטלה. הזיכוי מחכה לך בהרשמות שלך",
    doneRefund: "ההרשמה בוטלה. בקשת ההחזר התקבלה",
  },
  // Moving a booking (story 3.10), on the session page only, next to the
  // cancel (user decision 2026-10-18). Past the window both buttons show
  // cancel.closed.
  move: {
    button: "הזזה למועד אחר",
    title: "לאיזה מפגש לעבור?",
    from: "ההרשמה הנוכחית",
    targets: "המפגשים שאפשר לעבור אליהם",
    // A pinned booking: after the move it is funded by a credit (wording:
    // user decision 2026-10-18, phone check).
    pinnedNote:
      "לאחר שינוי התאריך, במקרה של ביטול תתאפשר קבלת זיכוי למפגש אחר בלבד, בהתאם למדיניות הביטולים, ולא החזר כספי.",
    empty: "אין כרגע מפגש אחר שאפשר לעבור אליו.",
    confirm: "כן, להזיז",
    // A booking funded from two kinds of entry: not moved here; followed by
    // the contact phrase.
    manual: "את ההזזה הזו לא ניתן לעשות כאן.",
    // Under a refusal: nothing changed.
    unchanged: "ההרשמה הנוכחית נשארה כמו שהייתה.",
    // On the new session's page after the move.
    done: (date: string) => `ההרשמה הועברה ל-${date}`,
  },
  // A moved booking in her history (story 3.10).
  bookingMoved: (date: string) => `הועברה ל-${date}`,
  // /me/bookings (story 3.6), opened from home.
  bookingsTitle: "ההרשמות שלי",
  allMyBookings: "לכל ההרשמות שלי",
  upcomingBookings: "הרשמות קרובות",
  pastBookings: "הרשמות קודמות",
  bookingsEmpty: "עוד אין לך הרשמות",
  toSchedule: "ללו״ז הבראנצ׳ים",
  // The chip of a past booking speaks of the brunch (masculine; user
  // decision 2026-10-13).
  bookingCancelled: "בוטל",
  bookingHeld: "התקיים",
  // The companion's dietary note of a couple booking, on its session page
  // (story 3.5, wording from the spec; moved there in 5.21, fix 7).
  // Editable until the session's registration closes; after it, read-only
  // with closedNote and contactPhrase.
  companion: {
    label: "הגבלות תזונה או אלרגיות של המלווה",
    empty: "לא נמסרו",
    edit: "עריכה",
    add: "הוספה",
    save: "שמירה",
    saved: "נשמר",
    // User's wording, 5.21 phone check (2026-10-20); contactPhrase follows
    // as the link.
    closedNote:
      "ההרשמה נסגרה וההכנות בעיצומן, לכן לא ניתן לעדכן כעת הגבלות תזונה. אם יש עדכון חשוב,",
  },
  // A cancelled session's page (story 3.5); its first line is
  // EVENT_CANCELLED in lib/errors.ts.
  cancelledBooked: "היית רשומה למפגש הזה. הפרטים בהרשמות שלך",
  toMyBookings: "להרשמות שלי",
} as const
