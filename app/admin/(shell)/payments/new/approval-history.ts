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

// Shared with the other admin forms (lib/idempotency.ts).
export { newIdempotencyKey } from "@/lib/idempotency"

// The remount key of the form (payment-form-host.tsx). Next keeps a visited
// page's state, so an untouched form remounts on a catalog change and takes
// the new prices. Once Tal typed, chose or got an answer, the catalog part
// is frozen (`frozenCatalog`): the refresh after CONFIRM_REQUIRED must not
// wipe her input; the amount she kept then asks for the price change. A
// product of the frozen catalog no longer offered (hidden, deactivated)
// remounts the form anyway: her choice may be gone.
export function catalogKey(
  products: readonly { id: string; priceAgorot: number }[]
): string {
  return products.map((p) => `${p.id}:${p.priceAgorot}`).join(",")
}

export function formRemountKey(
  sessionId: number,
  catalog: string,
  frozenCatalog: string | null
): string {
  const ids = (key: string) => key.split(",").map((part) => part.split(":")[0])
  const offered = new Set(ids(catalog))
  const keep =
    frozenCatalog !== null && ids(frozenCatalog).every((id) => offered.has(id))
  return `${sessionId}|${keep ? frozenCatalog : catalog}`
}
