"use client"

import { Button } from "@/components/ui/button"

// Reloads the page (story 5.9, /offline). The service worker answers a failed
// navigation with /offline at the address that was asked for, so a reload
// tries that address again.
export function RetryButton({ children }: { children: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="lg"
      className="h-12 px-[22px] text-base"
      onClick={() => window.location.reload()}
    >
      {children}
    </Button>
  )
}
