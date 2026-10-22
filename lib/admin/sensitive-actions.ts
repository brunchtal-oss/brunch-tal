// The sensitive actions of the admin (EXPERIENCE › sensitive-confirm-dialog):
// each key is one action, and its value is the question that titles the
// dialog. Every story that adds a sensitive action adds its key here; the
// impact box, the checkbox wording and the confirm label stay with the screen
// (lib/copy/*).

export const SENSITIVE_ACTIONS = {
  // Approving a payment whose amount differs from the catalog price (2.5),
  // and changing a product's catalog price (2.6).
  price_change: "האם לאשר שינוי מחיר?",
  // Cancelling a customer's booking (3.6), also inside the window.
  booking_cancel: "האם לבטל את ההרשמה?",
  // Moving a customer's booking to another session (3.10), any time.
  booking_move: "האם להזיז את ההרשמה?",
  // Deleting a concept that no session uses (4.8).
  concept_delete: "האם למחוק את הקונספט?",
  // Cancelling a whole session, and changing its time with bookings (3.8).
  event_cancel: "האם לבטל את המפגש?",
  event_reschedule: "האם לשנות את מועד המפגש?",
  // Deleting a draft or published session nobody booked (3.17).
  event_delete: "האם למחוק את המפגש?",
  // Recording a refund Tal paid outside the app (3.9, source §7).
  refund_complete: "האם לאשר החזר?",
  // Correcting a card (3.13, source §7): its expiry, its balance, and its
  // weekdays or event kind.
  entitlement_expiry: "האם לשנות את התוקף?",
  entitlement_units: "האם לתקן את היתרה?",
  entitlement_terms: "האם לשנות את תנאי הכרטיסייה?",
  // A purchase paid without a place in a session the business cancelled
  // (3.13): the customer chooses a refund or a credit.
  parked_settle: "האם להציע ללקוחה החזר או זיכוי?",
  // A credit (3.16, source §6-7): its alternatives (also how Tal extends
  // it), or a refund instead of it.
  credit_options: "האם לשנות את החלופות של הזיכוי?",
  credit_refund: "האם להחליף את הזיכוי בהחזר כספי?",
  // Removing a customer's personal details on her request (4.6, CAP-30).
  customer_anonymize: "האם להסיר את הפרטים האישיים?",
} as const

export type SensitiveAction = keyof typeof SENSITIVE_ACTIONS

export function sensitiveTitle(action: SensitiveAction): string {
  return SENSITIVE_ACTIONS[action]
}
