import { Suspense } from "react"

import { requireCustomer } from "@/lib/auth/require-customer"
import { authCopy } from "@/lib/copy/auth"

// Allowed only here and in /admin/(shell) (AD-16): the route reads the
// session on every request, so it blocks instead of instant navigation.
export const instant = false

// The customer check runs inside <Suspense> (cacheComponents, AD-16).
export default function MeLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <p className="px-4 py-10 text-muted-foreground">
          {authCopy.me.loading}
        </p>
      }
    >
      <CustomerGate>{children}</CustomerGate>
    </Suspense>
  )
}

async function CustomerGate({ children }: { children: React.ReactNode }) {
  await requireCustomer("/me")
  return children
}
