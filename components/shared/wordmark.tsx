import Link from "next/link"

import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

// The business name as type (no logo): Heebo 20/300, linking to the shell's
// home. 44px touch target. The public shell passes the published business
// name (story 5.2); otherwise the WORDMARK.
export function Wordmark({
  href,
  name = shellCopy.wordmark,
  className,
}: {
  href: string
  name?: string
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center rounded-sm font-heading text-xl leading-none font-light tracking-[0.01em] text-foreground",
        className
      )}
    >
      {name}
    </Link>
  )
}
