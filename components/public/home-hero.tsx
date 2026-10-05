import { PageHeading } from "@/components/shared/page-heading"
import type { HeroContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"

// The home page's hero, typographic (DESIGN.md › hero fallback: plain cream,
// the business name in wordmark-display, Heebo 40/200; the photo arrives in
// 5.4). Shared by the home page (published hero) and the admin preview (the
// draft), so both render the same thing. Without a valid hero: the business
// name only. No button (user's decision 2026-10-05): the home page's upcoming
// sessions, right after the intro, end with "לכל הבראנצ׳ים"; hero.cta_label
// is not shown. The name is the published business name, else the WORDMARK
// (story 5.2).
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
        </>
      )}
    </section>
  )
}
