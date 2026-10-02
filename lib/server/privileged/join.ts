import "server-only"

import type { JoinLinkState } from "@/lib/auth/join-link-state"
import type { ActionResult, ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createServiceClient } from "@/lib/server/privileged/service-client"

// Joining through a one-time link (AD-10, AD-21):
// join_begin (intent: claiming + pending_user_id) -> Auth Admin
// (getUserById, then updateUserById or createUser with that id) ->
// join_complete (profile, babies, consents, bind_purchase, consumed) ->
// the action signs in. A failure in the middle leaves the link `claiming`; a
// retry with the same input gets the same pending_user_id from join_begin and
// continues from step 2, so no second Auth user and no second binding. The
// idempotency key (one per page load, AD-5) makes a retry after a lost
// join_complete response return the stored result. Logs carry only ids and
// error codes, never the token, password, email, phone or name.

export type { JoinLinkState }

export type JoinTokenView = {
  state: JoinLinkState
  productName: string | null
  amountAgorot: number | null
}

type TokenViewResult = {
  state_public: "active" | "used" | "expired" | "conflict" | "not_found"
  purpose: string | null
  product_name: string | null
  amount_agorot: number | null
}

// Opening the link never changes its state. Unknown, revoked, expired and
// non-join links look the same.
export async function getJoinTokenView(token: string): Promise<JoinTokenView> {
  const result = await callRpc(createServiceClient(), "token_view", {
    p_token: token,
  })
  if (!result.ok) throw new Error("token_view failed")

  const view = result.data as TokenViewResult
  const closed = { productName: null, amountAgorot: null }
  if (view.purpose !== "join") return { state: "expired", ...closed }
  switch (view.state_public) {
    case "active":
      return {
        state: "active",
        productName: view.product_name,
        amountAgorot: view.amount_agorot,
      }
    case "used":
      return { state: "used", ...closed }
    case "conflict":
      return { state: "conflict", ...closed }
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
// normalized address to sign in with. conflict: Tal handles it.
export type JoinOutcome =
  { outcome: "joined"; email: string } | { outcome: "conflict" }

type BeginResult =
  | { outcome: "claiming"; token_id: string; pending_user_id: string }
  | { outcome: "conflict"; token_id: string }
  | { outcome: "joined"; token_id: string }

type CompleteResult =
  | { outcome: "joined"; token_id: string }
  | { outcome: "conflict"; token_id: string }

type ServiceClient = ReturnType<typeof createServiceClient>

type AuthStep =
  { kind: "ready" } | { kind: "conflict" } | { kind: "error"; code: ErrorCode }

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
  if (started.outcome === "conflict") {
    return { ok: true, data: { outcome: "conflict" } }
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
  if (auth.kind === "conflict") {
    return { ok: true, data: { outcome: "conflict" } }
  }
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
    return { ok: true, data: { outcome: "conflict" } }
  }
  return { ok: true, data: { outcome: "joined", email } }
}
