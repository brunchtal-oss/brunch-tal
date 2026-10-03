// System microcopy of the customer area (/me). The message and button after
// a purchase are product fields (content), not here.

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
  expiredBeforeBoundInfo: (weeks: number) =>
    `עברו ${weeks} שבועות מרכישת הכרטיסיה ולכן פג תוקפה. לבירורים צרי קשר`,
  contactPhrase: "צרי קשר",
  sessionsTitle: "מפגשים",
  sessionsSoon: "המפגשים יופיעו כאן בקרוב",
} as const
