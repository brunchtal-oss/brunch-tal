"use client"

import { useEffect } from "react"

// The home's "expiring" rows open the list at one card (#card-{id}, user
// decision 2026-10-10). A client navigation (pushState) does not update
// :target, so this marks the targeted row (data-targeted) and brings it
// into view once the rows are on the page, and again when the hash changes.
export function OpenCardTarget() {
  useEffect(() => {
    let marked: Element | null = null
    function mark() {
      marked?.removeAttribute("data-targeted")
      marked = null
      let hash: string
      try {
        hash = decodeURIComponent(window.location.hash.slice(1))
      } catch {
        // A malformed hash (e.g. #card-%E0): no card to mark.
        return
      }
      if (!hash.startsWith("card-")) return
      const row = document.getElementById(hash)
      if (!row) return
      row.setAttribute("data-targeted", "")
      row.scrollIntoView({ block: "center" })
      marked = row
    }
    mark()
    window.addEventListener("hashchange", mark)
    return () => {
      window.removeEventListener("hashchange", mark)
      marked?.removeAttribute("data-targeted")
    }
  }, [])
  return null
}
