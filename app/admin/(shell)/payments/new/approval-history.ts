// The success screen of an approval and the browser history (phone test,
// user decision 2026-10-03). On success the form pushes a history entry
// with ?approved=1, so Back (the same URL without the param) leaves the
// success screen: the form starts again, empty, with a new idempotency key.
// The "payments" tab leads to /admin/payments, and "add payment" there to a
// new page load. The raw link is shown once (AD-10); a reload of
// ?approved=1 shows the empty form and drops the param.
//
// form:   the form (or its errors); the URL has no param of ours
// pushed: approved, the entry was pushed; waiting for the URL to show it
// shown:  the success screen, with ?approved=1 in the URL
// reset:  the param is gone: start a new, empty form

export const APPROVED_PARAM = "approved"

export type ApprovalPhase = "form" | "pushed" | "shown" | "reset"

export function nextApprovalPhase(
  phase: ApprovalPhase,
  approvedInUrl: boolean
): ApprovalPhase {
  if (phase === "pushed") return approvedInUrl ? "shown" : "pushed"
  if (phase === "shown") return approvedInUrl ? "shown" : "reset"
  return phase
}

// A v4 UUID from getRandomValues, which (unlike crypto.randomUUID) also
// exists on the dev server opened by its LAN address (not a secure context).
export function newIdempotencyKey(
  random: (bytes: Uint8Array) => Uint8Array = (bytes) =>
    crypto.getRandomValues(bytes)
): string {
  const bytes = random(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
