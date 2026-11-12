"use server"

import { revalidatePath } from "next/cache"
import { after } from "next/server"

import { isEmailShape } from "@/lib/email"
import {
  codeFromPostgrestError,
  detailFromPostgrestError,
  type ActionResult,
  type ErrorDetail,
} from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { changeOwnEmail } from "@/lib/server/privileged/account"
import { sendVerificationEmail } from "@/lib/server/privileged/email-auth"
import {
  clientIp,
  hitRateLimit,
  rateLimitCode,
} from "@/lib/server/privileged/rate-limit"
import { parseSpecialBrunchInterests } from "@/lib/special-brunch"
import { createClient } from "@/lib/supabase/server"
import { isPlainDate } from "@/lib/time"

// The customer's profile (story 2.10). Each action checks only the shape
// and makes one write with the customer's own session: a column update of
// profiles (full_name, dietary_notes, special_brunch_interests) or babies (AD-1), where RLS keeps her
// to her own rows and private.babies_guard checks the birth date, the count
// and the last baby again; or set_photo_consent and
// set_personal_photo_consent (story 2.13). Self-updates are exempt from
// idempotency (AD-5). customer_id is never sent: the babies default fills
// it from the session.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type DbError = {
  code?: string
  message?: string
  details?: string | null
} | null

function fail(error: DbError): {
  ok: false
  code: ReturnType<typeof codeFromPostgrestError>
  detail?: ErrorDetail
} {
  const code = codeFromPostgrestError(error)
  if (code === "SERVER_ERROR") {
    console.error("profile.write_failed", { dbCode: error?.code ?? "unknown" })
    return { ok: false, code }
  }
  const detail = detailFromPostgrestError(error)
  return detail ? { ok: false, code, detail } : { ok: false, code }
}

function invalid(
  field: string,
  code: "INVALID_INPUT" | "FIELD_REQUIRED" = "INVALID_INPUT"
): ActionResult<never> {
  return { ok: false, code, detail: { field } }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null
}

function babyFields(input: {
  name?: unknown
  birthDate?: unknown
}):
  | { ok: false; error: ActionResult<never> }
  | { ok: true; name: string; birthDate: string } {
  const name = text(input?.name)
  const birthDate = text(input?.birthDate)
  if (!name) return { ok: false, error: invalid("baby_name", "FIELD_REQUIRED") }
  if (name.length > 100) return { ok: false, error: invalid("baby_name") }
  if (!birthDate)
    return { ok: false, error: invalid("birth_date", "FIELD_REQUIRED") }
  // Whether it is in range (2 years back to 9 months ahead, story 5.20) is
  // decided by the database only.
  if (!isPlainDate(birthDate))
    return { ok: false, error: invalid("birth_date") }
  return { ok: true, name, birthDate }
}

function done(): ActionResult {
  revalidatePath("/me/profile")
  return { ok: true, data: undefined }
}

type DetailsInput = {
  fullName: string
  dietaryNotes: string
  specialBrunchInterests: string[]
}

type DetailsFields = {
  full_name: string
  dietary_notes: string | null
  special_brunch_interests: NonNullable<
    ReturnType<typeof parseSpecialBrunchInterests>
  >
}

// The details' shape: the error to return, or the columns to write.
function detailsFields(
  input: DetailsInput
):
  { ok: false; error: ActionResult<never> } | { ok: true; row: DetailsFields } {
  const fullName = text(input?.fullName)
  // Required as a string ("" clears): a missing value never erases notes.
  const dietary = text(input?.dietaryNotes)
  // Story 2.16: required as an array ([] clears), known codes only; stored
  // each once in code order (the column's check refuses anything else).
  const interests = Array.isArray(input?.specialBrunchInterests)
    ? parseSpecialBrunchInterests(input.specialBrunchInterests)
    : null
  if (!fullName)
    return { ok: false, error: invalid("full_name", "FIELD_REQUIRED") }
  if (fullName.length > 200) return { ok: false, error: invalid("full_name") }
  if (dietary === null || dietary.length > 2000) {
    return { ok: false, error: invalid("dietary_notes") }
  }
  if (interests === null) {
    return { ok: false, error: invalid("special_brunch_interests") }
  }
  return {
    ok: true,
    row: {
      full_name: fullName,
      dietary_notes: dietary || null,
      special_brunch_interests: interests,
    },
  }
}

// One column update of her own profile row, with her session (RLS).
async function writeDetails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  row: DetailsFields
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("profiles")
    .update(row)
    .eq("id", userId)
    .select("id")
  if (error) return fail(error)
  // RLS let no row through: not an active customer.
  if (!data?.length) return { ok: false, code: "NOT_AUTHORIZED" }
  return { ok: true, data: undefined }
}

export async function updateDetails(
  input: DetailsInput
): Promise<ActionResult> {
  const fields = detailsFields(input)
  if (!fields.ok) return fields.error

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (typeof userId !== "string") return { ok: false, code: "NOT_AUTHORIZED" }

  const saved = await writeDetails(supabase, userId, fields.row)
  if (!saved.ok) return saved
  return done()
}

export async function addBaby(input: {
  name: string
  birthDate: string
}): Promise<ActionResult> {
  const fields = babyFields(input)
  if (!fields.ok) return fields.error

  const { error } = await (
    await createClient()
  )
    .from("babies")
    .insert({ name: fields.name, birth_date: fields.birthDate })
  if (error) return fail(error)
  return done()
}

export async function updateBaby(input: {
  id: string
  name: string
  birthDate: string
}): Promise<ActionResult> {
  if (typeof input?.id !== "string" || !UUID.test(input.id)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const fields = babyFields(input)
  if (!fields.ok) return fields.error

  const { data, error } = await (
    await createClient()
  )
    .from("babies")
    .update({ name: fields.name, birth_date: fields.birthDate })
    .eq("id", input.id)
    .select("id")
  if (error) return fail(error)
  if (!data?.length) return { ok: false, code: "NOT_FOUND" }
  return done()
}

export async function deleteBaby(input: { id: string }): Promise<ActionResult> {
  if (typeof input?.id !== "string" || !UUID.test(input.id)) {
    return { ok: false, code: "INVALID_INPUT" }
  }
  const { data, error } = await (
    await createClient()
  )
    .from("babies")
    .delete()
    .eq("id", input.id)
    .select("id")
  if (error) return fail(error)
  if (!data?.length) return { ok: false, code: "NOT_FOUND" }
  return done()
}

export async function setPhotoConsent(input: {
  consent: boolean
}): Promise<ActionResult> {
  if (typeof input?.consent !== "boolean") return invalid("photo_consent")
  const result = await callRpc(await createClient(), "set_photo_consent", {
    p_consent: input.consent,
  })
  if (!result.ok) return result
  return done()
}

// The personal photo consent (story 2.13): the same rules as
// setPhotoConsent, through set_personal_photo_consent.
export async function setPersonalPhotoConsent(input: {
  consent: boolean
}): Promise<ActionResult> {
  if (typeof input?.consent !== "boolean") {
    return invalid("personal_photo_consent")
  }
  const result = await callRpc(
    await createClient(),
    "set_personal_photo_consent",
    { p_consent: input.consent }
  )
  if (!result.ok) return result
  return done()
}

// Story 6.11 (user decisions 2026-11-11 and 2026-11-12): the details form
// with a new email in it. The form calls this only when the address
// changed; otherwise updateDetails. The session, the details' shape, the
// rate limit (the email bucket, per IP and per user id), the email's shape
// (the new address twice, her current password); then changeOwnEmail: her
// password on a stateless client first (wrong: nothing is saved), then the
// details, then begin_my_email_change (the duplicate check), Auth,
// finish_my_email_change. A failure of the email part after the details
// were saved comes back on the email field (the details stay saved; a new
// save repeats them harmlessly). Her session is then refreshed so its
// claims carry the new address, and the verification email goes to it
// after the answer (a failed send never fails the change). A stuck change
// (Auth failed after begin) stays email_change_pending, in Tal's "to
// handle" after 15 minutes.
export async function updateDetailsWithEmailAction(
  input: DetailsInput & {
    email: string
    confirm: string
    password: string
    idempotencyKey: string
  }
): Promise<ActionResult<{ email: string }>> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (typeof userId !== "string" || !userId) {
    return { ok: false, code: "NOT_AUTHORIZED" }
  }

  const fields = detailsFields(input)
  if (!fields.ok) return fields.error

  // Its own id, so the banner's resend never uses up her changes.
  const limited = rateLimitCode(
    await hitRateLimit("email", {
      ip: await clientIp(),
      id: `change:${userId}`,
    })
  )
  if (limited) return { ok: false, code: limited }

  const email = text(input?.email)?.toLowerCase() ?? ""
  const confirm = text(input?.confirm)?.toLowerCase() ?? ""
  if (!email) return invalid("email", "FIELD_REQUIRED")
  if (!isEmailShape(email)) return invalid("email")
  if (confirm !== email) {
    return {
      ok: false,
      code: "EMAILS_DONT_MATCH",
      detail: { field: "confirm" },
    }
  }
  if (typeof input.password !== "string" || !input.password) {
    return invalid("password", "FIELD_REQUIRED")
  }
  if (input.password.length > 200) return invalid("password")
  if (!UUID.test(String(input.idempotencyKey))) return invalid("email")

  // Her current address as Auth holds it (the session's claims may be
  // older, after Tal changed it).
  const { data: current, error: userError } = await supabase.auth.getUser()
  const currentEmail = current.user?.email
  if (userError || !currentEmail || current.user?.id !== userId) {
    return { ok: false, code: "SERVER_ERROR" }
  }

  const result = await changeOwnEmail(
    { userId, currentEmail, email, password: input.password },
    input.idempotencyKey,
    () => writeDetails(supabase, userId, fields.row)
  )
  if (!result.ok) {
    const { stage, ...failure } = result
    if (stage === "details") return failure
    // The details are saved; the view shows them on the next load.
    revalidatePath("/me/profile")
    if (
      failure.code === "WRONG_PASSWORD" ||
      failure.code === "TOO_MANY_ATTEMPTS" ||
      failure.detail?.field
    ) {
      return failure
    }
    return { ...failure, detail: { field: "email" } }
  }

  // The new address into her session's claims (the login, the profile).
  const { error } = await supabase.auth.refreshSession()
  if (error) {
    console.error("profile.refresh_failed", {
      authCode: error.code ?? "unknown",
    })
  }
  after(() => sendVerificationEmail(userId))
  revalidatePath("/me/profile")
  return { ok: true, data: { email } }
}
