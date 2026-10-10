import "server-only"

import { createHash } from "node:crypto"

import {
  toConflictReason,
  type ConflictReason,
  type JoinLinkState,
} from "@/lib/auth/join-link-state"
import { joinCopy } from "@/lib/copy/join"
import type { ActionResult, ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createServiceClient } from "@/lib/server/privileged/service-client"
import { formatSessionDate } from "@/lib/time"

// Joining through a one-time link (AD-10, AD-21):
// join_begin (intent: claiming + pending_user_id) -> Auth Admin
// (getUserById, then updateUserById or createUser with that id) ->
// join_complete (profile, babies, consents, bind_purchase, consumed) ->
// the action signs in. Details that match an existing account stop at step 1
// (existing_account: the link waits for that account to log in and confirm
// through claim_join, story 2.3); no Auth user is created for them. A failure
// in the middle leaves the link `claiming`; a retry with the same input gets
// the same pending_user_id from join_begin and continues from step 2, so no
// second Auth user and no second binding. Other input on a claiming or
// awaiting_login link is checked again (story 2.4): join_begin may first ask
// to delete the Auth user of the previous input (discard_pending_user). The
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
  // A pinned purchase's session (story 3.11); null for a days product.
  session_starts_at?: string | null
  concept_name?: string | null
  conflict_reason?: string | null
  bound_user_id?: string | null
}

// The purchase as the customer sees it: a pinned one by its session
// ("בראנץ׳ {concept} · {day DD.MM}", story 3.11), otherwise the product.
function purchaseName(view: TokenViewResult): string | null {
  if (view.session_starts_at && view.concept_name) {
    return joinCopy.pinnedPurchase(
      view.concept_name,
      formatSessionDate(view.session_starts_at)
    )
  }
  return view.product_name
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
        productName: purchaseName(view),
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
  personalPhotoConsent: boolean | null
  babies: ReadonlyArray<{ name: string; birthDate: string }>
}

// joined: the account exists and the purchase is bound; `email` is the
// normalized address to sign in with. existing_account: the details belong to
// an account, which logs in and confirms (the result never says which field
// matched). identity_retry: the details matched two accounts, the link stays
// open for another attempt (with a new idempotency key). conflict: the link
// stopped, with the reason for the wording (null when unknown).
// email_exists: Auth refused the email; the link stays open for a corrected
// email (story 2.4).
export type JoinOutcome =
  | { outcome: "joined"; email: string }
  | { outcome: "existing_account" }
  | { outcome: "identity_retry" }
  | { outcome: "email_exists" }
  | { outcome: "conflict"; reason: ConflictReason | null }

type BeginResult =
  | { outcome: "claiming"; token_id: string; pending_user_id: string }
  | { outcome: "existing_account"; token_id: string }
  | { outcome: "identity_retry"; token_id: string }
  | { outcome: "conflict"; token_id: string; reason?: string | null }
  | { outcome: "joined"; token_id: string }
  | {
      outcome: "discard_pending_user"
      token_id: string
      pending_user_id: string
    }

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
  // The email belongs to another Auth user: the link stays `claiming`, open
  // for a corrected email (join_begin checks other input again, 2.4).
  if (authCode === "email_exists" || authCode === "user_already_exists") {
    console.error("join.email_exists", { tokenId })
    return { kind: "conflict" }
  }
  console.error("join.create_user_failed", { tokenId, authCode })
  return { kind: "error", code: "SERVER_ERROR" }
}

// The idempotency key of one join step (AD-5), derived from the page's key,
// the input (email lower(trim()), phone digits) and the step, so a resubmit
// of the same page with the same input repeats the same keys, and other
// input never reuses a key stored with an earlier input. join_complete runs
// under the "begin" key: join_begin looks up the join_complete result of the
// key it was given (a lost response after the link was consumed).
export function joinStepKey(
  pageKey: string,
  email: string,
  phone: string,
  step: "begin" | "after_discard"
): string {
  const hex = createHash("sha256")
    .update(
      [
        pageKey,
        email.trim().toLowerCase(),
        phone.replace(/\D/g, ""),
        step,
      ].join("|")
    )
    .digest("hex")
  // UUID layout, version 5 and RFC 4122 variant bits.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// Deletes an Auth user of a join link that has no profile, so it does not
// block a future link with the same email (not_activated). Called only with
// an id the SQL returned for that purpose: the pending user of a
// join_complete conflict (the profile was rolled back), of
// discard_pending_user, or of a claiming link Tal revoked. The profile is
// read first: a parallel submission (another tab) may have completed the
// join with this very user since; then nothing is deleted and the flow goes
// on (the next join_begin answers LINK_USED). A user that is already gone
// counts as deleted. Returns false on a failure, logged with ids and codes
// only.
export async function deleteOrphanUser(
  supabase: ServiceClient,
  userId: string,
  tokenId: string
): Promise<boolean> {
  try {
    const profile = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle()
    if (profile.error) {
      console.error("join.delete_orphan_failed", {
        tokenId,
        authCode: "profile_read",
      })
      return false
    }
    if (profile.data) {
      console.error("join.delete_orphan_skipped", { tokenId, userId })
      return true
    }
    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (!error || error.status === 404 || error.code === "user_not_found") {
      return true
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
  return false
}

export async function submitJoin(
  token: string,
  input: JoinInput,
  idempotencyKey: string
): Promise<ActionResult<JoinOutcome>> {
  const supabase = createServiceClient()
  // The same normalization as private.join_identity, for Auth and sign-in.
  const email = input.email.trim().toLowerCase()

  const stepKey = (step: "begin" | "after_discard") =>
    joinStepKey(idempotencyKey, input.email, input.phone, step)
  const callBegin = (step: "begin" | "after_discard") =>
    callRpc(supabase, "join_begin", {
      p_token: token,
      p_email: input.email,
      p_phone: input.phone,
      p_idempotency_key: stepKey(step),
    })

  const begin = await callBegin("begin")
  if (!begin.ok) return begin

  let started = begin.data as BeginResult
  // A correction while the Auth user of the previous input exists: delete
  // it, then ask again under the after_discard key (the stored answer of the
  // begin key is the discard). Once only; a second discard is unexpected.
  if (started.outcome === "discard_pending_user") {
    const deleted = await deleteOrphanUser(
      supabase,
      started.pending_user_id,
      started.token_id
    )
    if (!deleted) return { ok: false, code: "SERVER_ERROR" }
    const again = await callBegin("after_discard")
    if (!again.ok) return again
    started = again.data as BeginResult
    if (started.outcome === "discard_pending_user") {
      console.error("join.discard_repeated", { tokenId: started.token_id })
      return { ok: false, code: "SERVER_ERROR" }
    }
  }

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
  // email_exists in Auth: the form stays open for a corrected email.
  if (auth.kind === "conflict") {
    return { ok: true, data: { outcome: "email_exists" } }
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
      personal_photo_consent: input.personalPhotoConsent,
      babies: input.babies.map((baby) => ({
        name: baby.name,
        birth_date: baby.birthDate,
      })),
    },
    p_idempotency_key: stepKey("begin"),
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
