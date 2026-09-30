import { Suspense } from "react"

import { BottomTabBar } from "@/components/shared/bottom-tab-bar"
import { RoleGate } from "@/components/shared/role-gate"
import { SkipLink } from "@/components/shared/skip-link"
import { Wordmark } from "@/components/shared/wordmark"
import { shellCopy } from "@/lib/copy/shell"
import { customerNav } from "@/lib/nav"

// Allowed only here and in /admin/(shell) (AD-16): the route reads the
// session on every request, so it blocks instead of instant navigation.
export const instant = false

// Customer shell (AD-2): app top-bar (wordmark row), main, and the
// bottom-tab-bar at every width. globals.css keeps the page clear of the bar.
// The role check runs inside <Suspense> (cacheComponents, AD-16).
export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink />
      <header className="bg-background">
        <div className="mx-auto flex max-w-[720px] items-center px-6 py-3">
          <Wordmark href="/me" />
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-6 pt-2"
      >
        <Suspense
          fallback={
            <p className="text-muted-foreground">{shellCopy.loading}</p>
          }
        >
          <RoleGate role="customer">{children}</RoleGate>
        </Suspense>
      </main>
      <BottomTabBar items={customerNav} label={shellCopy.nav.customerLabel} />
    </>
  )
}
