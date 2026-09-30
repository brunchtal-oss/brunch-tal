"use server"

import { redirect } from "next/navigation"

import { destinationFor, toSessionRole } from "@/lib/auth/destination"
import type { ErrorCode } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// The email is echoed back so the form keeps it after an error (React resets
// the form after an action). The password is never echoed.
export type LoginFormState = null | {
  ok: false
  code: ErrorCode
  email: string
}

// Shared by /login and /admin/login. After a successful sign-in the
// destination follows the role (destinationFor): an admin goes to /admin, a
// customer to /me, whatever page she signed in on. A user with no active
// profile is signed out at once (ACCOUNT_NOT_ACTIVE), so she never loops
// between /me and /login.
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

  const role = await callRpc(supabase, "get_my_session_role")
  const destination = role.ok
    ? destinationFor(toSessionRole(role.data), formData.get("next"))
    : null

  if (!destination) {
    // No usable role: do not keep a session that no screen accepts.
    await supabase.auth.signOut()
    return {
      ok: false,
      code: role.ok ? "ACCOUNT_NOT_ACTIVE" : "SERVER_ERROR",
      email,
    }
  }

  redirect(destination)
}
