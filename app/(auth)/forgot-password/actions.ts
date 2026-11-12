"use server"

import { after } from "next/server"

import { isEmailShape } from "@/lib/email"
import type { ErrorCode } from "@/lib/errors"
import { sendResetIfEligible } from "@/lib/server/privileged/email-auth"
import {
  clientIp,
  hitRateLimit,
  rateLimitCode,
} from "@/lib/server/privileged/rate-limit"

// Story 6.11: "forgot password". The rate limit first (the email bucket:
// per IP and per normalized address), then the shape. The answer is the
// same for an unknown, unverified, anonymized, inactive or eligible
// address: the eligibility read and the send run in after(), so neither
// the answer nor its timing differs. The address is never logged.

export type ForgotFormState =
  | null
  | { ok: true; email: string }
  | { ok: false; code: ErrorCode; email: string }

export async function requestResetAction(
  _previous: ForgotFormState,
  formData: FormData
): Promise<ForgotFormState> {
  const raw = formData.get("email")
  const typed = typeof raw === "string" ? raw.slice(0, 320) : ""
  const email = typed.trim().toLowerCase()

  const limited = rateLimitCode(
    await hitRateLimit("email", { ip: await clientIp(), id: email || "-" })
  )
  if (limited) return { ok: false, code: limited, email: typed }

  if (!isEmailShape(email)) {
    return { ok: false, code: "INVALID_INPUT", email: typed }
  }

  after(() => sendResetIfEligible(email))
  return { ok: true, email }
}
