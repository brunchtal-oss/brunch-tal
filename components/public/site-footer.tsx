import Link from "next/link"

import type { FooterContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"

// The public footer (story 5.2): the business name, the published footer
// text (site › footer, content:global) and the fixed admin entrance. The
// privacy policy and accessibility statement links arrive in 5.5.
export function SiteFooter({
  name,
  footer,
}: {
  name: string
  footer: FooterContent | null
}) {
  return (
    <footer className="mt-12 border-t border-border">
      <div className="mx-auto flex max-w-[720px] flex-col gap-2 px-6 pt-6 pb-4">
        <p className="font-heading text-xl leading-none font-light tracking-[0.01em]">
          {name}
        </p>
        {footer && (
          <p className="text-[15px] leading-normal whitespace-pre-line text-muted-foreground">
            {footer.text}
          </p>
        )}
        <nav aria-label={shellCopy.nav.footerLabel}>
          <Link
            href="/admin/login"
            className="inline-flex min-h-11 items-center rounded-sm text-[13px] text-muted-foreground underline underline-offset-[3px]"
          >
            {shellCopy.public.adminLogin}
          </Link>
        </nav>
      </div>
    </footer>
  )
}
