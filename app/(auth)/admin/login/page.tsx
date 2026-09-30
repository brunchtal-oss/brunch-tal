import type { Metadata } from "next"

import { LoginScreen, loginTitle } from "../../login/login-screen"

export const metadata: Metadata = {
  title: loginTitle("admin"),
}

// Admin entrance (source §3), outside the admin shell, with the same form and
// action as /login.
export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <LoginScreen area="admin" searchParams={searchParams} />
}
