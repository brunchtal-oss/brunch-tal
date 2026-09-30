import { Suspense } from "react"
import type { Metadata } from "next"

import { safeNext } from "@/lib/auth/safe-next"
import { authCopy } from "@/lib/copy/auth"

import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: authCopy.login.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <h1 className="font-heading text-2xl font-semibold">
        {authCopy.login.title}
      </h1>
      <Suspense fallback={<LoginForm next={null} />}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function LoginFormWithNext({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { next } = await searchParams
  return <LoginForm next={safeNext(next)} />
}
