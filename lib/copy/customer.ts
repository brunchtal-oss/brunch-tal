// System microcopy of the customer area (/me). The message and button after
// a purchase are product fields (content), not here.

export const customerCopy = {
  purchase: "אישור רכישה:",
  purchasedOn: "נרכשה ב-",
  balancesTitle: "הכניסות שלי",
  available: (count: number) => `${count} זמינות`,
  reserved: (count: number) => `${count} משוריינות`,
  validUntil: "בתוקף עד",
  sessionsTitle: "מפגשים",
  sessionsSoon: "המפגשים יופיעו כאן בקרוב",
} as const
