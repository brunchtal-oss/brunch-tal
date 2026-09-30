import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PageHeading } from "@/components/shared/page-heading"
import { SignOutButton } from "@/components/shared/sign-out-button"
import { buttonVariants } from "@/components/ui/button"
import {
  loginPageOutcome,
  toSessionRole,
  type SessionRole,
} from "@/lib/auth/destination"
import { safeNext } from "@/lib/auth/safe-next"
import { authCopy } from "@/lib/copy/auth"
import { shellCopy } from "@/lib/copy/shell"
import { errorMessage } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { LoginForm } from "./login-form"

export type LoginArea = "customer" | "admin"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /login and /admin/login: the same form and action. A visitor who already
// has a session is sent on when her role belongs to this page (/login:
// customer or admin; /admin/login: admin). Otherwise (no active profile, or a
// customer on /admin/login) a notice above the form offers sign-out, so the
// guard of /me or /admin never loops back here.
export function LoginScreen({
  area,
  searchParams,
}: {
  area: LoginArea
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{loginTitle(area)}</PageHeading>
      <Suspense fallback={<LoginForm next={null} />}>
        <LoginBody area={area} searchParams={searchParams} />
      </Suspense>
    </>
  )
}

export function loginTitle(area: LoginArea) {
  return area === "admin" ? authCopy.login.adminTitle : authCopy.login.title
}

async function LoginBody({
  area,
  searchParams,
}: {
  area: LoginArea
  searchParams: SearchParams
}) {
  const { next } = await searchParams
  const safe = safeNext(next)
  const outcome = loginPageOutcome(area, await currentRole(), safe)

  if (outcome.redirect) redirect(outcome.redirect)

  return (
    <>
      {outcome.notice && <SessionNotice role={outcome.notice} />}
      <LoginForm next={safe} />
    </>
  )
}

// The session's role, or null for a guest or when the lookup fails (then the
// plain form is shown).
async function currentRole(): Promise<SessionRole | null> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return null

  const result = await callRpc(supabase, "get_my_session_role")
  return result.ok ? toSessionRole(result.data) : null
}

function SessionNotice({ role }: { role: SessionRole }) {
  const isCustomer = role === "customer"
  return (
    <InlineNotice
      tone="warning"
      actions={
        <>
          <SignOutButton />
          {isCustomer && (
            <Link
              href="/me"
              className={buttonVariants({
                variant: "outline",
                className:
                  "min-h-11 border-foreground bg-transparent px-4 text-base font-semibold",
              })}
            >
              {shellCopy.gate.goToMe}
            </Link>
          )}
        </>
      }
    >
      {isCustomer
        ? shellCopy.gate.customerOnAdmin
        : errorMessage("ACCOUNT_NOT_ACTIVE")}
    </InlineNotice>
  )
}
