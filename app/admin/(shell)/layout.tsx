import { Suspense } from "react"

import { SideNav } from "@/components/admin/side-nav"
import { BottomTabBar } from "@/components/shared/bottom-tab-bar"
import { RoleGate } from "@/components/shared/role-gate"
import { SignOutButton } from "@/components/shared/sign-out-button"
import { SkipLink } from "@/components/shared/skip-link"
import { Wordmark } from "@/components/shared/wordmark"
import { shellCopy } from "@/lib/copy/shell"
import { adminNav } from "@/lib/nav"

// Allowed only here and in /me (AD-16).
export const instant = false

// Admin shell (AD-2): wordmark row, main, bottom-tab-bar until lg and a 240px
// side-nav (with sign-out) from lg. The bell-button and /admin/notifications
// come in 5.7. The role check runs inside <Suspense> (AD-16).
export default function AdminShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SkipLink />
      <div className="flex min-h-svh">
        <SideNav
          items={adminNav}
          label={shellCopy.nav.adminLabel}
          footer={<SignOutButton />}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background">
            <div className="mx-auto flex max-w-[720px] items-center px-6 py-3">
              <Wordmark href="/admin" />
            </div>
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-6 pt-2 pb-8"
          >
            <Suspense
              fallback={
                <p className="text-muted-foreground">{shellCopy.loading}</p>
              }
            >
              <RoleGate role="admin">{children}</RoleGate>
            </Suspense>
          </main>
        </div>
      </div>
      <BottomTabBar
        items={adminNav}
        label={shellCopy.nav.adminLabel}
        mobileOnly
      />
    </>
  )
}
