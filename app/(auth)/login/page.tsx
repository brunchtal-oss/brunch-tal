import type { Metadata } from "next"

import { LoginScreen, loginTitle } from "./login-screen"

export const metadata: Metadata = {
  title: loginTitle("customer"),
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <LoginScreen area="customer" searchParams={searchParams} />
}
