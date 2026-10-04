import Link from "next/link"

import { PageHeading } from "@/components/shared/page-heading"
import { buttonVariants } from "@/components/ui/button"
import type { HeroContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"
import { hasPublicSessions, SESSIONS_HREF } from "@/lib/nav"

// The home page's hero, typographic (DESIGN.md › hero fallback: plain cream,
// the business name in wordmark-display, Heebo 40/200, then button-primary;
// the photo arrives in 5.4). Shared by the home page (published hero) and
// the admin preview (the draft), so both render the same thing. Without a
// valid hero: the business name only. The button leads to /sessions and is
// shown only once that page is in the public navigation (3.2). The name is
// the published business name, else the WORDMARK (story 5.2).
export function HomeHero({
  hero,
  name = shellCopy.wordmark,
}: {
  hero: HeroContent | null
  name?: string
}) {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col items-center justify-center px-6 pt-16 pb-4 text-center">
      <PageHeading className="text-[40px] leading-[1.15] font-extralight">
        {name}
      </PageHeading>
      {hero && (
        <>
          <p className="mt-6 max-w-[22ch] font-heading text-[22px] leading-[1.25] font-light text-balance">
            {hero.title}
          </p>
          {hero.description && (
            <p className="mt-3 max-w-[34ch] text-base leading-normal text-pretty whitespace-pre-line text-muted-foreground">
              {hero.description}
            </p>
          )}
          {hasPublicSessions() && (
            <Link
              href={SESSIONS_HREF}
              className={buttonVariants({
                className:
                  "mt-8 h-12 rounded-[4px] px-6 text-base font-semibold",
              })}
            >
              {hero.cta_label}
            </Link>
          )}
        </>
      )}
    </section>
  )
}
