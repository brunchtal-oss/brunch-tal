import type { JoinErrorKey } from "@/lib/copy/join"
import { isEmailShape } from "@/lib/email"
import { customerPhoneE164 } from "@/lib/phone"
import type { ErrorCode, ErrorDetail } from "@/lib/errors"

// The join form's fields and their validation before any call to the
// database or Auth (story 2.2). Pure: no "use server" (only async functions
// may be exported there) and no server-only import.

const MIN_PASSWORD_LENGTH = 8
// The same limit as join_complete.
export const MAX_BABIES = 10
// The same text limits as join_complete, checked before any other check.
const MAX_FULL_NAME = 200
const MAX_DIETARY_NOTES = 2000
const MAX_BABY_NAME = 100
// The phone: the server's own rules (customerPhoneE164 mirrors
// private.normalize_phone), so "הבא" stops a number the server would refuse
// (story 2.15); the server still decides. The email: lib/email.ts (length
// first, then a linear regex).
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

// A code from lib/errors.ts or a field message of lib/copy/join.ts.
// detailsTaken: only Tal's fill (story 2.15) returns it; its words come from
// the fill page (the form's fieldMessage).
export type JoinFieldMessage = ErrorCode | JoinErrorKey | "detailsTaken"

export type JoinFieldError = {
  field: JoinField
  index?: number
  message: JoinFieldMessage
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
  else if (fullName.length > MAX_FULL_NAME) {
    errors.push({ field: "fullName", message: "INVALID_INPUT" })
  }
  if (!phone) errors.push({ field: "phone", message: "FIELD_REQUIRED" })
  else if (!customerPhoneE164(phone))
    errors.push({ field: "phone", message: "phone" })
  if (!email) errors.push({ field: "email", message: "FIELD_REQUIRED" })
  else if (!isEmailShape(email)) {
    errors.push({ field: "email", message: "email" })
  }
  if (dietary.length > MAX_DIETARY_NOTES) {
    errors.push({ field: "dietaryNotes", message: "INVALID_INPUT" })
  }

  const rows = Math.max(names.length, dates.length, 1)
  if (rows > MAX_BABIES) {
    errors.push({ field: "babyName", index: 0, message: "INVALID_INPUT" })
  }
  for (let index = 0; index < Math.min(rows, MAX_BABIES); index++) {
    if (!names[index]) {
      errors.push({ field: "babyName", index, message: "FIELD_REQUIRED" })
    } else if (names[index].length > MAX_BABY_NAME) {
      errors.push({ field: "babyName", index, message: "INVALID_INPUT" })
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

// INVALID_INPUT and CONSENT_REQUIRED from the RPCs, mapped to the field the
// SQL named (detail.field, detail.index). Shared by the customer's link and
// Tal's fill (story 2.15).
export function rpcFieldError(
  code: ErrorCode,
  detail: ErrorDetail | undefined
): JoinFieldError | null {
  if (code === "CONSENT_REQUIRED") return { field: "privacy", message: code }
  if (code === "PASSWORD_TOO_SHORT") return { field: "password", message: code }
  if (code !== "INVALID_INPUT" || !detail?.field) return null
  const index = detail.index
  switch (detail.field) {
    case "email":
      return { field: "email", message: "email" }
    case "phone":
      return { field: "phone", message: "phone" }
    case "full_name":
      return { field: "fullName", message: code }
    case "dietary_notes":
      return { field: "dietaryNotes", message: code }
    case "photo_consent":
      return { field: "photoConsent", message: "photoConsent" }
    case "personal_photo_consent":
      return {
        field: "personalPhotoConsent",
        message: "personalPhotoConsent",
      }
    case "baby_name":
      return { field: "babyName", index: index ?? 0, message: "FIELD_REQUIRED" }
    case "birth_date":
      return { field: "birthDate", index: index ?? 0, message: "birthDate" }
    case "babies":
      return { field: "babyName", index: 0, message: code }
    default:
      return null
  }
}
