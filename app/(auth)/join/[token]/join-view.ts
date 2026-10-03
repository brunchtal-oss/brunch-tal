import type { SessionRole } from "@/lib/auth/destination"
import type { ConflictReason, JoinLinkState } from "@/lib/auth/join-link-state"
import { joinCopy } from "@/lib/copy/join"

import type { JoinFormState } from "./actions"

export type JoinView = "form" | "joined" | "used" | "expired" | "conflict"

// The link states the join form shows; awaiting_login has its own screens
// (claim-join.tsx).
export type FormLinkState = Exclude<JoinLinkState, "awaiting_login">

// Which screen the join page shows. A result of this submission wins over
// the link state read when the page opened: "joined" (the account exists but
// the sign-in failed) shows "account created" with the login button,
// LINK_USED the "used" screen, LINK_EXPIRED the expired one, and a conflict
// "contact for details". An existing account never reaches this view: the
// action redirects to the page, which shows the login.
export function joinView(
  state: JoinFormState,
  linkState: FormLinkState
): JoinView {
  if (state?.status === "joined") return "joined"
  if (state?.status === "used") return "used"
  if (state?.status === "expired") return "expired"
  if (state?.status === "conflict") return "conflict"
  return linkState === "active" ? "form" : linkState
}

// The login of an existing account that claims a join link (story 2.3).
export function claimLoginHref(token: string): string {
  return `/login?next=${encodeURIComponent(`/join/${token}`)}`
}

// Which existing-account screen an awaiting_login link shows for the session
// (null = no session): log in; confirm only for the customer the link is
// bound to (isBoundAccount); "another account" with sign-out for any other
// customer, an admin or a user without an active profile (who could not
// complete the login screen: /login sends them elsewhere).
export function existingAccountScreen(
  role: SessionRole | null,
  isBoundAccount: boolean
): "login" | "claim" | "other_account" {
  if (role === null) return "login"
  return role === "customer" && isBoundAccount ? "claim" : "other_account"
}

// The wording of a stopped link by its reason. An unknown reason (a result
// stored before the reasons existed) reads as a bind conflict.
export function conflictMessage(reason: ConflictReason | null): string {
  return joinCopy.conflicts[reason ?? "bind_conflict"]
}

// The idempotency key of the next submission: identity_retry and
// email_exists hand a new one (the previous key is stored with the previous
// input); otherwise the current one stays.
export function nextIdempotencyKey(
  state: JoinFormState,
  current: string
): string {
  return state?.status === "identity_retry" || state?.status === "email_exists"
    ? state.idempotencyKey
    : current
}
