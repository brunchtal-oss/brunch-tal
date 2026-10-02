import type { JoinLinkState } from "@/lib/auth/join-link-state"

import type { JoinFormState } from "./actions"

export type JoinView = "form" | "joined" | "used" | "expired" | "conflict"

// Which screen the join page shows. A result of this submission wins over
// the link state read when the page opened: "joined" (the account exists but
// the sign-in failed) shows "account created" with the login button,
// LINK_USED the "used" screen, LINK_EXPIRED the expired one, and a conflict
// "Tal will get back to you".
export function joinView(
  state: JoinFormState,
  linkState: JoinLinkState
): JoinView {
  if (state?.status === "joined") return "joined"
  if (state?.status === "used") return "used"
  if (state?.status === "expired") return "expired"
  if (state?.status === "conflict") return "conflict"
  return linkState === "active" ? "form" : linkState
}
