"use client"

import { toast } from "sonner"

import { Toaster } from "@/components/ui/sonner"
import { customerCopy } from "@/lib/copy/customer"

// DESIGN.md › Toast: only the non-critical "saved" confirmation of the
// profile (story 2.10), at least 6 seconds, polite, no actions inside. Above
// the bottom tab bar (64px + safe area).
export function ProfileToaster() {
  return (
    <Toaster
      dir="rtl"
      position="bottom-center"
      duration={6000}
      offset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      mobileOffset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
    />
  )
}

export function toastSaved() {
  toast.success(customerCopy.profile.saved)
}
