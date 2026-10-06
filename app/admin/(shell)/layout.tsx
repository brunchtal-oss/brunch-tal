import { Suspense } from "react"

import { SideNav } from "@/components/admin/side-nav"
import { AppTopBar } from "@/components/shared/app-top-bar"
import { BottomTabBar } from "@/components/shared/bottom-tab-bar"
import { PushSync } from "@/components/shared/push-sync"
import { RoleGate } from "@/components/shared/role-gate"
import { ShellBell } from "@/components/shared/shell-bell"
import { SkipLink } from "@/components/shared/skip-link"
import { shellCopy } from "@/lib/copy/shell"
import { adminNav } from "@/lib/nav"

import { getUnreadCount, registerPush } from "./notifications/actions"

// Allowed only here and in /me (AD-16).
export const instant = false

// Admin shell (AD-2): the sticky olive top-bar across the whole width (name,
// bell, sign-out; story 5.7), then main with the bottom-tab-bar until lg, or
// the 240px side-nav right under the bar from lg. The role check runs
// inside <Suspense> (AD-16).
export default function AdminShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SkipLink />
      <AppTopBar
        home="/admin"
        wide
        bell={<ShellBell surface="admin" refresh={getUnreadCount} />}
      />
      <div className="flex min-h-[calc(100svh-4rem)]">
        <SideNav items={adminNav} label={shellCopy.nav.adminLabel} />
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-6 pt-6 pb-8"
          >
            <Suspense
              fallback={
                <p className="text-muted-foreground">{shellCopy.loading}</p>
              }
            >
              <RoleGate role="admin">
                <PushSync register={registerPush} />
                {children}
              </RoleGate>
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
