import "server-only"

import {
  toConflictReason,
  type ConflictReason,
  type JoinLinkState,
} from "@/lib/auth/join-link-state"
import type { ActionResult, ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createServiceClient } from "@/lib/server/privileged/service-client"

// Joining through a one-time link (AD-10, AD-21):
// join_begin (intent: claiming + pending_user_id) -> Auth Admin
// (getUserById, then updateUserById or createUser with that id) ->
// join_complete (profile, babies, consents, bind_purchase, consumed) ->
// the action signs in. Details that match an existing account stop at step 1
// (existing_account: the link waits for that account to log in and confirm
// through claim_join, story 2.3); no Auth user is created for them. A failure in the middle leaves the link `claiming`; a
// retry with the same input gets the same pending_user_id from join_begin and
// continues from step 2, so no second Auth user and no second binding. The
// idempotency key (one per page load, AD-5) makes a retry after a lost
// join_complete response return the stored result. Logs carry only ids and
// error codes, never the token, password, email, phone or name.

export type { ConflictReason, JoinLinkState }

// conflictReason: only for a link in conflict (null for an unknown reason).
// boundUserId: the account an awaiting_login link waits for. Server only:
// the page compares it with the session user and passes on only the screen
// choice, never the id.
export type JoinTokenView = {
  state: JoinLinkState
  productName: string | null
  amountAgorot: number | null
  conflictReason: ConflictReason | null
  boundUserId: string | null
}

type TokenViewResult = {
  state_public:
    "active" | "awaiting_login" | "used" | "expired" | "conflict" | "not_found"
  purpose: string | null
  product_name: string | null
  amount_agorot: number | null
  conflict_reason?: string | null
  bound_user_id?: string | null
}

// Opening the link never changes its state. Unknown, revoked, expired and
// non-join links look the same.
export async function getJoinTokenView(token: string): Promise<JoinTokenView> {
  const result = await callRpc(createServiceClient(), "token_view", {
    p_token: token,
  })
  if (!result.ok) throw new Error("token_view failed")

  const view = result.data as TokenViewResult
  const closed = {
    productName: null,
    amountAgorot: null,
    conflictReason: null,
    boundUserId: null,
  }
  if (view.purpose !== "join") return { state: "expired", ...closed }
  switch (view.state_public) {
    case "active":
    case "awaiting_login":
      return {
        state: view.state_public,
        productName: view.product_name,
        amountAgorot: view.amount_agorot,
        conflictReason: null,
        boundUserId:
          view.state_public === "awaiting_login"
            ? (view.bound_user_id ?? null)
            : null,
      }
    case "used":
      return { state: "used", ...closed }
    case "conflict":
      return {
        state: "conflict",
        ...closed,
        conflictReason: toConflictReason(view.conflict_reason),
      }
    default:
      return { state: "expired", ...closed }
  }
}

export type JoinInput = {
  email: string
  phone: string
  password: string
  fullName: string
  dietaryNotes: string | null
  privacyConsent: boolean
  photoConsent: boolean | null
  babies: ReadonlyArray<{ name: string; birthDate: string }>
}

// joined: the account exists and the purchase is bound; `email` is the
// normalized address to sign in with. existing_account: the details belong to
// an account, which logs in and confirms (the result never says which field
// matched). identity_retry: the details matched two accounts, the link stays
// open for another attempt (with a new idempotency key). conflict: the link
// stopped, with the reason for the wording (null when unknown).
export type JoinOutcome =
  | { outcome: "joined"; email: string }
  | { outcome: "existing_account" }
  | { outcome: "identity_retry" }
  | { outcome: "conflict"; reason: ConflictReason | null }

type BeginResult =
  | { outcome: "claiming"; token_id: string; pending_user_id: string }
  | { outcome: "existing_account"; token_id: string }
  | { outcome: "identity_retry"; token_id: string }
  | { outcome: "conflict"; token_id: string; reason?: string | null }
  | { outcome: "joined"; token_id: string }

type CompleteResult =
  | { outcome: "joined"; token_id: string }
  | { outcome: "conflict"; token_id: string; reason?: string | null }

type ServiceClient = ReturnType<typeof createServiceClient>

type AuthStep =
  { kind: "ready" } | { kind: "conflict" } | { kind: "error"; code: ErrorCode }

const conflict = (reason: unknown): ActionResult<JoinOutcome> => ({
  ok: true,
  data: { outcome: "conflict", reason: toConflictReason(reason) },
})

// Step 2: the Auth user pending_user_id exists with this password. Called
// after join_begin answered `claiming` for this input, but a parallel
// submission with another key may have consumed the link since then: the
// user then already has an activated account, so an existing user's password
// is changed only while the link is still active (claiming). Otherwise the
// Auth step is skipped and join_complete answers (LINK_USED or the stored
// result).
async function ensureAuthUser(
  supabase: ServiceClient,
  token: string,
  userId: string,
  email: string,
  password: string,
  tokenId: string
): Promise<AuthStep> {
  const setPassword = async (): Promise<AuthStep> => {
    const view = await callRpc(supabase, "token_view", { p_token: token })
    if (!view.ok) return { kind: "error", code: "SERVER_ERROR" }
    if ((view.data as TokenViewResult).state_public !== "active") {
      return { kind: "ready" }
    }
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password,
    })
    if (!error) return { kind: "ready" }
    const authCode = error.code ?? "unknown"
    console.error("join.update_user_failed", { tokenId, authCode })
    return {
      kind: "error",
      code:
        authCode === "weak_password" ? "PASSWORD_TOO_SHORT" : "SERVER_ERROR",
    }
  }

  const exists = async (): Promise<boolean | null> => {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    if (data?.user) return true
    if (!error || error.status === 404 || error.code === "user_not_found") {
      return false
    }
    console.error("join.get_user_failed", {
      tokenId,
      authCode: error.code ?? "unknown",
    })
    return null
  }

  const found = await exists()
  if (found === null) return { kind: "error", code: "SERVER_ERROR" }
  if (found) return setPassword()

  const { error } = await supabase.auth.admin.createUser({
    id: userId,
    email,
    password,
    email_confirm: true,
  })
  if (!error) return { kind: "ready" }

  const authCode = error.code ?? "unknown"
  if (authCode === "weak_password") {
    return { kind: "error", code: "PASSWORD_TOO_SHORT" }
  }
  // A parallel submission of the same form may have created this very user
  // in the meantime (its email then also "exists"): continue with it.
  const again = await exists()
  if (again === null) return { kind: "error", code: "SERVER_ERROR" }
  if (again) return setPassword()
  // The email belongs to another Auth user: the link stays `claiming` and
  // Tal handles it (2.4).
  if (authCode === "email_exists" || authCode === "user_already_exists") {
    console.error("join.email_exists", { tokenId })
    return { kind: "conflict" }
  }
  console.error("join.create_user_failed", { tokenId, authCode })
  return { kind: "error", code: "SERVER_ERROR" }
}

// A conflict in join_complete (phone taken, BIND_CONFLICT) rolled back the
// profile, so the Auth user of step 2 has no profile and would block a future
// link with the same email (not_activated). It is deleted; a failure is only
// logged (the customer still sees the conflict), and a user that is already
// gone (a retry of the same conflict) is fine.
async function deleteOrphanUser(
  supabase: ServiceClient,
  userId: string,
  tokenId: string
): Promise<void> {
  try {
    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (!error || error.status === 404 || error.code === "user_not_found") {
      return
    }
    console.error("join.delete_orphan_failed", {
      tokenId,
      authCode: error.code ?? "unknown",
    })
  } catch {
    console.error("join.delete_orphan_failed", {
      tokenId,
      authCode: "exception",
    })
  }
}

export async function submitJoin(
  token: string,
  input: JoinInput,
  idempotencyKey: string
): Promise<ActionResult<JoinOutcome>> {
  const supabase = createServiceClient()
  // The same normalization as private.join_identity, for Auth and sign-in.
  const email = input.email.trim().toLowerCase()

  const begin = await callRpc(supabase, "join_begin", {
    p_token: token,
    p_email: input.email,
    p_phone: input.phone,
    p_idempotency_key: idempotencyKey,
  })
  if (!begin.ok) return begin

  const started = begin.data as BeginResult
  if (started.outcome === "conflict") return conflict(started.reason)
  if (started.outcome === "existing_account") {
    return { ok: true, data: { outcome: "existing_account" } }
  }
  if (started.outcome === "identity_retry") {
    return { ok: true, data: { outcome: "identity_retry" } }
  }
  // This key already completed the join and only the response was lost: no
  // Auth change, just sign in.
  if (started.outcome === "joined") {
    return { ok: true, data: { outcome: "joined", email } }
  }

  const tokenId = started.token_id
  const auth = await ensureAuthUser(
    supabase,
    token,
    started.pending_user_id,
    email,
    input.password,
    tokenId
  )
  // email_exists in Auth: shown like phone_taken.
  if (auth.kind === "conflict") return conflict("email_exists")
  if (auth.kind === "error") return { ok: false, code: auth.code }

  const complete = await callRpc(supabase, "join_complete", {
    p_token: token,
    p_profile: {
      email: input.email,
      phone: input.phone,
      full_name: input.fullName,
      dietary_notes: input.dietaryNotes,
      privacy_consent: input.privacyConsent,
      photo_consent: input.photoConsent,
      babies: input.babies.map((baby) => ({
        name: baby.name,
        birth_date: baby.birthDate,
      })),
    },
    p_idempotency_key: idempotencyKey,
  })
  if (!complete.ok) {
    // The Auth user exists and the link stays `claiming`: submitting again
    // continues from step 2.
    if (complete.code === "SERVER_ERROR") {
      console.error("join.complete_failed", { tokenId })
    }
    return complete
  }

  const done = complete.data as CompleteResult
  if (done.outcome === "conflict") {
    await deleteOrphanUser(supabase, started.pending_user_id, tokenId)
    return conflict(done.reason)
  }
  return { ok: true, data: { outcome: "joined", email } }
}
