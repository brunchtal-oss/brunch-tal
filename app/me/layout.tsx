import { Suspense } from "react"

import { AppTopBar } from "@/components/shared/app-top-bar"
import { BottomTabBar } from "@/components/shared/bottom-tab-bar"
import { PushSync } from "@/components/shared/push-sync"
import { RoleGate } from "@/components/shared/role-gate"
import { ShellBell } from "@/components/shared/shell-bell"
import { SkipLink } from "@/components/shared/skip-link"
import { shellCopy } from "@/lib/copy/shell"
import { customerNav } from "@/lib/nav"

import { getUnreadCount, registerPush } from "./notifications/actions"

// Allowed only here and in /admin/(shell) (AD-16): the route reads the
// session on every request, so it blocks instead of instant navigation.
export const instant = false

// Customer shell (AD-2): the sticky olive top-bar (name, bell, sign-out;
// story 5.7), main, and the bottom-tab-bar at every width. globals.css keeps
// the page clear of the bar. The role check runs inside <Suspense>
// (cacheComponents, AD-16).
export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SkipLink />
      <AppTopBar
        home="/me"
        bell={<ShellBell surface="customer" refresh={getUnreadCount} />}
      />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[720px] flex-col gap-8 px-6 pt-6"
      >
        <Suspense
          fallback={
            <p className="text-muted-foreground">{shellCopy.loading}</p>
          }
        >
          <RoleGate role="customer">
            <PushSync register={registerPush} />
            {children}
          </RoleGate>
        </Suspense>
      </main>
      <BottomTabBar items={customerNav} label={shellCopy.nav.customerLabel} />
    </>
  )
}
