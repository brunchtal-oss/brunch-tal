import { LogOutIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { signOutAction } from "@/lib/auth/sign-out"
import { shellCopy } from "@/lib/copy/shell"

import { PushEndpointField } from "./push-endpoint-field"

// button-secondary: transparent, 1px ink border, 44px. `next`: where the
// login after signing out goes (passes safeNext in signOutAction). The
// device's push endpoint goes along, so its subscription is removed
// (story 5.8).
export function SignOutButton({
  className,
  next,
}: {
  className?: string
  next?: string
}) {
  return (
    <form action={signOutAction} className={className}>
      {next && <input type="hidden" name="next" value={next} />}
      <PushEndpointField />
      <Button
        type="submit"
        variant="outline"
        className="min-h-11 w-full gap-2 border-foreground bg-transparent px-4 text-base font-semibold"
      >
        <LogOutIcon
          aria-hidden
          strokeWidth={1.5}
          className="size-5 rtl:-scale-x-100"
        />
        {shellCopy.signOut}
      </Button>
    </form>
  )
}
