import { Suspense } from "react"

import type { ActionResult } from "@/lib/errors"
import { loadUnreadCount } from "@/lib/notifications/load"
import {
  notificationsHref,
  type NotificationSurface,
} from "@/lib/notifications/shared"

import { BellButton } from "./bell-button"

// The bell of a shell's top-bar (story 5.7): its first count is read on the
// server inside <Suspense> (it reads the session's cookies, AD-16); until it
// arrives the bell shows without a count. `refresh` is the surface's
// getUnreadCount Server Action.
export function ShellBell({
  surface,
  refresh,
}: {
  surface: NotificationSurface
  refresh: () => Promise<ActionResult<number>>
}) {
  const href = notificationsHref(surface)
  return (
    <Suspense fallback={<BellButton href={href} initialCount={null} />}>
      <LoadedBell surface={surface} href={href} refresh={refresh} />
    </Suspense>
  )
}

async function LoadedBell({
  surface,
  href,
  refresh,
}: {
  surface: NotificationSurface
  href: string
  refresh: () => Promise<ActionResult<number>>
}) {
  const count = await loadUnreadCount(surface)
  return <BellButton href={href} initialCount={count} refresh={refresh} />
}
