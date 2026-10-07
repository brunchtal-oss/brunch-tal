import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

// A quiet "back" link at the top of the card and its history pages. RTL
// only, so the chevron points to the inline start.
export function BackLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] text-muted-foreground hover:text-foreground"
    >
      <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-4" />
      {children}
    </Link>
  )
}
