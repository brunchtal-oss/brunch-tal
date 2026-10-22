import type { PromoBannerContent } from "@/lib/content/schema"

// home › promo_banner (fix 15): a short announcement right under the hero,
// a straight olive ribbon (primary, on-primary text 8.46:1) with a dashed
// "stitch" line above and below, the text in bold Rubik (--font-promo,
// app/layout.tsx; user decision 2026-10-22, outside DESIGN's two families).
// Text only: no link, no button. Shown only when the section is visible
// (on, with text; lib/content/visible.ts).
export function PromoBanner({ content }: { content: PromoBannerContent }) {
  const text = content.text?.trim()
  if (!text) return null
  return (
    <div
      data-slot="promo-banner"
      className="w-full bg-primary py-1.5 text-primary-foreground"
    >
      <div className="border-y-[1.5px] border-dashed border-primary-foreground/55 px-4 py-3 sm:py-4">
        <p className="mx-auto max-w-[900px] text-center font-[family-name:var(--font-promo)] text-2xl leading-[1.25] font-bold text-balance sm:text-[30px]">
          {text}
        </p>
      </div>
    </div>
  )
}
