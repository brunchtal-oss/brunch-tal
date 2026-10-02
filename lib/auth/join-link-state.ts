// Public state of a join link as shown on /join/[token]. awaiting_login: the
// details matched an existing account (story 2.3), which logs in and confirms.
export type JoinLinkState =
  "active" | "awaiting_login" | "used" | "expired" | "conflict"

// Why a join link stopped (activation_tokens.conflict_reason), plus
// email_exists from the Auth step, shown like phone_taken. The screen picks
// its wording by the reason; never the field that matched.
export const CONFLICT_REASONS = [
  "two_accounts",
  "not_activated",
  "phone_taken",
  "bind_conflict",
  "email_exists",
] as const

export type ConflictReason = (typeof CONFLICT_REASONS)[number]

export function toConflictReason(value: unknown): ConflictReason | null {
  return CONFLICT_REASONS.includes(value as ConflictReason)
    ? (value as ConflictReason)
    : null
}
