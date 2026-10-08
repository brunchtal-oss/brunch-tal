import Link from "next/link"

import { getPublishedPageSlugs } from "@/lib/content/pages"
import { shellCopy } from "@/lib/copy/shell"
import { publicLegalNav, visibleLegalNav, type LegalNavItem } from "@/lib/nav"

// A quiet row of legal links (story 5.5; the login pages, under the form):
// the accessibility statement always, the others once published
// (visibleLegalNav). Server only: reads the published slugs from the cache.
export async function LegalLinks({
  only,
}: {
  only: readonly LegalNavItem["slug"][]
}) {
  const published = await getPublishedPageSlugs(
    publicLegalNav.map((item) => item.slug)
  )
  return <LegalLinksRow items={visibleLegalNav(published, only)} />
}

export function LegalLinksRow({
  items,
}: {
  items: readonly { href: string; label: string }[]
}) {
  if (items.length === 0) return null
  return (
    <nav aria-label={shellCopy.public.legal.linksLabel}>
      <ul className="flex flex-wrap items-center gap-x-6 text-[15px] text-muted-foreground">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="inline-flex min-h-11 items-center underline underline-offset-[3px] hover:text-foreground"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
