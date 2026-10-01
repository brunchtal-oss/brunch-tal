import Link from "next/link"

import { Alert, AlertTitle } from "@/components/ui/alert"
import { buttonVariants } from "@/components/ui/button"
import { authCopy } from "@/lib/copy/auth"

// "Already used" and "expired / revoked / unknown" screens of a reset link.
export function LinkStateNotice({ state }: { state: "used" | "expired" }) {
  if (state === "used") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTitle>{authCopy.reset.used}</AlertTitle>
        </Alert>
        <Link
          href="/login"
          className={buttonVariants({
            size: "lg",
            className: "h-12 text-base",
          })}
        >
          {authCopy.reset.goToLogin}
        </Link>
      </div>
    )
  }

  return (
    <Alert>
      <AlertTitle className="whitespace-normal">
        {authCopy.reset.expired}
      </AlertTitle>
    </Alert>
  )
}
