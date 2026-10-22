import Image from "next/image"

import { PageHeading } from "@/components/shared/page-heading"
import type { ResolvedImage } from "@/lib/content/pages"
import type { HeroContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"
import { objectPosition } from "@/lib/media/photo"

// The home page's hero. Shared by the home page (published hero) and the
// admin preview (the draft), so both render the same thing. No button
// (user's decision 2026-10-05): the home page's upcoming sessions, right
// after the intro, end with "לכל הבראנצ׳ים"; hero.cta_label is not shown.
// The name is the published business name, else the WORDMARK (story 5.2).
//
// With a published photo (story 5.4, DESIGN.md › hero): the photo
// full-bleed, at least 560px high (it grows with the text), shown at its
// focus point; the text at the bottom in on-primary over a scrim that is
// never below 72% behind any text (85% at the bottom edge); the name in
// Heebo 49/400, 64 from sm (user's decision 2026-10-22, was display-xl
// 46/300). Loaded first (priority), never lazy.
// Without one: the typographic fallback (plain cream, the business name in
// wordmark-display, Heebo 40/200). In both the title is Heebo 24/400, 30
// from sm, and the description Heebo 19/400, 26 from sm (same decision, were
// display-sm and body).
export function HomeHero({
  hero,
  name = shellCopy.wordmark,
  image = null,
}: {
  hero: HeroContent | null
  name?: string
  image?: ResolvedImage | null
}) {
  if (image) {
    return (
      <section className="relative isolate flex min-h-[560px] w-full flex-col justify-end overflow-hidden bg-foreground text-primary-foreground">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          priority
          sizes="100vw"
          unoptimized={image.unoptimized}
          className="-z-10 object-cover"
          style={{ objectPosition: objectPosition(image.focusX, image.focusY) }}
        />
        {/* The scrim belongs to the text block (scrim-ink = ink): clear at
            its top, 72% where the text starts (12rem down, its padding) and
            85% at the bottom, so it stays behind the text however long it
            grows. */}
        <div className="w-full bg-[linear-gradient(to_bottom,rgb(46_42_31/0)_0,rgb(46_42_31/0.72)_12rem,rgb(46_42_31/0.85)_100%)]">
          <div className="mx-auto flex w-full max-w-[720px] flex-col items-center px-6 pt-48 pb-10 text-center">
            <PageHeading className="text-[49px] leading-[1.05] font-normal text-primary-foreground sm:text-[64px]">
              {name}
            </PageHeading>
            {hero && (
              <>
                {hero.title && (
                  <p className="mt-5 max-w-[22ch] font-heading text-[24px] leading-[1.25] font-normal text-balance sm:text-[30px]">
                    {hero.title}
                  </p>
                )}
                {hero.description && (
                  <p className="mt-3 max-w-[30ch] font-heading text-[19px] leading-[1.35] font-normal text-pretty whitespace-pre-line sm:text-[26px]">
                    {hero.description}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-col items-center justify-center px-6 pt-16 pb-4 text-center">
      <PageHeading className="text-[40px] leading-[1.15] font-extralight">
        {name}
      </PageHeading>
      {hero && (
        <>
          {hero.title && (
            <p className="mt-6 max-w-[22ch] font-heading text-[24px] leading-[1.25] font-normal text-balance sm:text-[30px]">
              {hero.title}
            </p>
          )}
          {hero.description && (
            <p className="mt-3 max-w-[30ch] font-heading text-[19px] leading-[1.35] font-normal text-pretty whitespace-pre-line text-muted-foreground sm:text-[26px]">
              {hero.description}
            </p>
          )}
        </>
      )}
    </section>
  )
}
