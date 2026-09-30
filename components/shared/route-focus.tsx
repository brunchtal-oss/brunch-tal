"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

// After a client navigation (not on the first render) focus moves to the
// page's h1, so a screen reader announces the new page. Rendered once in the
// layout of each shell.
export function RouteFocus() {
  const pathname = usePathname()
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    document.querySelector<HTMLElement>("#main h1")?.focus()
  }, [pathname])

  return null
}
