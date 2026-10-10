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
  // Deleting a notes topic that has notes, archived ones included (4.11).
  delete_note_topic: "האם למחוק את הנושא?",
} as const

export type SensitiveAction = keyof typeof SENSITIVE_ACTIONS

export function sensitiveTitle(action: SensitiveAction): string {
  return SENSITIVE_ACTIONS[action]
}
