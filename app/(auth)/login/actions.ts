"use server"

import { redirect } from "next/navigation"

import { safeNext } from "@/lib/auth/safe-next"
import type { ErrorCode } from "@/lib/errors"
import { createClient } from "@/lib/supabase/server"

// The email is echoed back so the form keeps it after an error (React resets
// the form after an action). The password is never echoed.
export type LoginFormState = null | {
  ok: false
  code: ErrorCode
  email: string
}

export async function loginAction(
  _previous: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const email = formData.get("email")
  const password = formData.get("password")

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    // One message for both fields: never reveal which one is wrong.
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      email: typeof email === "string" ? email : "",
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) {
    const authCode = error.code ?? "unknown"
    if (authCode !== "invalid_credentials") {
      console.error("login.sign_in_failed", { authCode, status: error.status })
    }
    // Only a real credentials mismatch says "email or password"; network
    // failures, rate limits and server errors are shown as a server error.
    const code: ErrorCode =
      authCode === "invalid_credentials"
        ? "INVALID_CREDENTIALS"
        : "SERVER_ERROR"
    return { ok: false, code, email }
  }

  redirect(safeNext(formData.get("next")) ?? "/me")
}
