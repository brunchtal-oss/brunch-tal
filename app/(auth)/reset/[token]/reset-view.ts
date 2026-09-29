import type { ResetLinkState } from "@/lib/auth/reset-link-state"

import type { ResetFormState } from "./actions"

export type ResetView =
  "saved-signed-in" | "saved-login" | "used" | "expired" | "form"

// Which screen the reset page shows. A successful save wins over the link
// state: after the sign-in the page refreshes and the server then reports the
// link as "used", but the customer must still see "saved".
export function resetView(
  state: ResetFormState,
  linkState: ResetLinkState
): ResetView {
  if (state?.ok) return state.data.signedIn ? "saved-signed-in" : "saved-login"
  if (linkState !== "active") return linkState
  if (state && !state.ok && state.code === "LINK_USED") return "used"
  if (state && !state.ok && state.code === "LINK_EXPIRED") return "expired"
  return "form"
}
