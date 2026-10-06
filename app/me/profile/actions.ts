"use server"

import { revalidatePath } from "next/cache"

import {
  codeFromPostgrestError,
  detailFromPostgrestError,
  type ActionResult,
  type ErrorDetail,
} from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"
import { isPlainDate } from "@/lib/time"

// The customer's profile (story 2.10). Each action checks only the shape
// and makes one write with the customer's own session: a column update of
// profiles (full_name, dietary_notes) or babies (AD-1), where RLS keeps her
// to her own rows and private.babies_guard checks the birth date, the count
// and the last baby again; or set_photo_consent. Self-updates are exempt
// from idempotency (AD-5). customer_id is never sent: the babies default
// fills it from the session.

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
  // Whether it is in the future is decided by the database only.
  if (!isPlainDate(birthDate))
    return { ok: false, error: invalid("birth_date") }
  return { ok: true, name, birthDate }
}

function done(): ActionResult {
  revalidatePath("/me/profile")
  return { ok: true, data: undefined }
}

export async function updateDetails(input: {
  fullName: string
  dietaryNotes: string
}): Promise<ActionResult> {
  const fullName = text(input?.fullName)
  // Required as a string ("" clears): a missing value never erases notes.
  const dietary = text(input?.dietaryNotes)
  if (!fullName) return invalid("full_name", "FIELD_REQUIRED")
  if (fullName.length > 200) return invalid("full_name")
  if (dietary === null || dietary.length > 2000) return invalid("dietary_notes")

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub
  if (typeof userId !== "string") return { ok: false, code: "NOT_AUTHORIZED" }

  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, dietary_notes: dietary || null })
    .eq("id", userId)
    .select("id")
  if (error) return fail(error)
  // RLS let no row through: not an active customer.
  if (!data?.length) return { ok: false, code: "NOT_AUTHORIZED" }
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
