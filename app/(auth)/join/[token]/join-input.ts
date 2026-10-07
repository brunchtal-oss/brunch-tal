import type { JoinErrorKey } from "@/lib/copy/join"
import type { ErrorCode } from "@/lib/errors"

// The join form's fields and their validation before any call to the
// database or Auth (story 2.2). Pure: no "use server" (only async functions
// may be exported there) and no server-only import.

const MIN_PASSWORD_LENGTH = 8
// The same limit as join_complete.
export const MAX_BABIES = 10
// Soft format checks only (AD-9): the server normalizes and decides.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const PHONE = /^\+?[\d\s().-]{9,20}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export type JoinField =
  | "fullName"
  | "phone"
  | "email"
  | "babyName"
  | "birthDate"
  | "dietaryNotes"
  | "password"
  | "confirm"
  | "privacy"
  | "photoConsent"
  | "personalPhotoConsent"

// message: a code from lib/errors.ts or a field message of lib/copy/join.ts.
export type JoinFieldError = {
  field: JoinField
  index?: number
  message: ErrorCode | JoinErrorKey
}

// The validated input; the same shape as JoinInput of
// lib/server/privileged/join.ts (not imported: AD-4 keeps that module out of
// non-privileged files).
export type ValidJoinInput = {
  email: string
  phone: string
  password: string
  fullName: string
  dietaryNotes: string | null
  privacyConsent: boolean
  photoConsent: boolean
  personalPhotoConsent: boolean
  babies: Array<{ name: string; birthDate: string }>
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

// Validation before any call to the database or Auth. Returns every field
// error at once, so the form can show a summary.
export function validateJoin(
  formData: FormData
):
  | { ok: true; input: ValidJoinInput }
  | { ok: false; errors: JoinFieldError[] } {
  const errors: JoinFieldError[] = []
  const fullName = text(formData, "fullName").trim()
  const phone = text(formData, "phone").trim()
  const email = text(formData, "email").trim()
  const dietary = text(formData, "dietaryNotes").trim()
  const password = text(formData, "password")
  const confirm = text(formData, "confirm")
  const photo = text(formData, "photoConsent")
  const personalPhoto = text(formData, "personalPhotoConsent")
  const names = formData.getAll("babyName").map((v) => String(v).trim())
  const dates = formData.getAll("birthDate").map((v) => String(v).trim())

  if (!fullName) errors.push({ field: "fullName", message: "FIELD_REQUIRED" })
  if (!phone) errors.push({ field: "phone", message: "FIELD_REQUIRED" })
  else if (!PHONE.test(phone)) errors.push({ field: "phone", message: "phone" })
  if (!email) errors.push({ field: "email", message: "FIELD_REQUIRED" })
  else if (!EMAIL.test(email)) errors.push({ field: "email", message: "email" })

  const rows = Math.max(names.length, dates.length, 1)
  if (rows > MAX_BABIES) {
    errors.push({ field: "babyName", index: 0, message: "INVALID_INPUT" })
  }
  for (let index = 0; index < Math.min(rows, MAX_BABIES); index++) {
    if (!names[index]) {
      errors.push({ field: "babyName", index, message: "FIELD_REQUIRED" })
    }
    const date = dates[index] ?? ""
    if (!date) {
      errors.push({ field: "birthDate", index, message: "FIELD_REQUIRED" })
    } else if (!DATE.test(date)) {
      errors.push({ field: "birthDate", index, message: "INVALID_INPUT" })
    }
  }

  if (!password) {
    errors.push({ field: "password", message: "FIELD_REQUIRED" })
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: "password", message: "PASSWORD_TOO_SHORT" })
  } else if (!confirm) {
    errors.push({ field: "confirm", message: "FIELD_REQUIRED" })
  } else if (confirm !== password) {
    errors.push({ field: "confirm", message: "PASSWORDS_DONT_MATCH" })
  }
  if (formData.get("privacyConsent") === null) {
    errors.push({ field: "privacy", message: "CONSENT_REQUIRED" })
  }
  if (photo !== "yes" && photo !== "no") {
    errors.push({ field: "photoConsent", message: "photoConsent" })
  }
  if (personalPhoto !== "yes" && personalPhoto !== "no") {
    errors.push({
      field: "personalPhotoConsent",
      message: "personalPhotoConsent",
    })
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    input: {
      email,
      phone,
      password,
      fullName,
      dietaryNotes: dietary || null,
      privacyConsent: true,
      photoConsent: photo === "yes",
      personalPhotoConsent: personalPhoto === "yes",
      babies: names.map((name, index) => ({ name, birthDate: dates[index] })),
    },
  }
}
