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
  // Deleting a notes topic that has notes, archived ones included (4.11).
  delete_note_topic: "האם למחוק את הנושא?",
  // Deleting a concept that no session uses (4.8).
  concept_delete: "האם למחוק את הקונספט?",
  // Cancelling a whole session, and changing its time with bookings (3.8).
  event_cancel: "האם לבטל את המפגש?",
  event_reschedule: "האם לשנות את מועד המפגש?",
  // Deleting a draft or published session nobody booked (3.17).
  event_delete: "האם למחוק את המפגש?",
  // Recording a refund Tal paid outside the app (3.9, source §7).
  refund_complete: "האם לאשר החזר?",
} as const

export type SensitiveAction = keyof typeof SENSITIVE_ACTIONS

export function sensitiveTitle(action: SensitiveAction): string {
  return SENSITIVE_ACTIONS[action]
}
