"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"

// "ההרשמה הועברה ל-{date}" on the new session's page after a move (story
// 3.10), shown once: on arrival with ?moved=1 the param is removed from the
// address (router.replace, no scroll), so a reload or "back" does not show
// it again. The page renders this component in the same place with or
// without the param, so the state keeps the notice for this visit after
// the address changes. InlineNotice (success) has role="status".
export function MovedNotice({
  arrived,
  message,
}: {
  arrived: boolean
  message: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [shown] = useState(arrived)

  useEffect(() => {
    if (arrived) router.replace(pathname, { scroll: false })
  }, [arrived, pathname, router])

  if (!shown) return null
  return (
    <InlineNotice tone="success" className="mb-4">
      {message}
    </InlineNotice>
  )
}
