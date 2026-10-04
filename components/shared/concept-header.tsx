import {
  Bona_Nova,
  David_Libre,
  Frank_Ruhl_Libre,
  Suez_One,
} from "next/font/google"

import { conceptTheme, type ConceptFace } from "@/lib/concepts/themes"
import { customerCopy } from "@/lib/copy/customer"
import { formatAccessibleDateTime, formatSessionDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"

// The concept faces (DESIGN.md › Typography, AD-16): loaded only by the
// session components (this file and session-card.tsx), Hebrew subset,
// font-display swap so the name reads before the face arrives. Heebo is the
// site's heading face already.
const bonaNova = Bona_Nova({
  subsets: ["hebrew"],
  weight: "400",
  display: "swap",
})
const davidLibre = David_Libre({
  subsets: ["hebrew"],
  weight: "400",
  display: "swap",
})
const frankRuhlLibre = Frank_Ruhl_Libre({
  subsets: ["hebrew"],
  weight: "700",
  display: "swap",
})
const suezOne = Suez_One({
  subsets: ["hebrew"],
  weight: "400",
  display: "swap",
})

const FACES: Record<ConceptFace, string> = {
  heebo: "font-heading font-light",
  "bona-nova": bonaNova.className,
  "david-libre": davidLibre.className,
  "frank-ruhl-libre": cn(frankRuhlLibre.className, "tracking-[-0.01em]"),
  "suez-one": suezOne.className,
}

/** The class of a concept's face, for the concept name only. */
export function conceptFaceClass(face: ConceptFace): string {
  return FACES[face]
}

/** The field and ink of a concept as CSS variables, for inline style. */
export function conceptStyle(field: string, ink: string): React.CSSProperties {
  return {
    "--concept-field": field,
    "--concept-ink": ink,
  } as React.CSSProperties
}

// DESIGN.md › concept-header: the top of a session page, a full-width field
// in the concept's paper with "בראנץ׳", the concept name (the page's h1) in
// the concept face at 40-46px and the date, all in the concept ink. No
// photo yet (5.4): the field closes with normal spacing, never an empty
// frame. Full-bleed inside the 24px gutter of the customer shell.
export function ConceptHeader({
  conceptName,
  themeKey,
  paperKey,
  startsAt,
  children,
}: {
  conceptName: string
  themeKey: string | null
  paperKey: string | null
  startsAt: string
  // Under the date, still on the field (e.g. the status-chip).
  children?: React.ReactNode
}) {
  const theme = conceptTheme(themeKey, paperKey)
  return (
    <header
      style={conceptStyle(theme.field, theme.ink)}
      className="-mx-6 -mt-2 bg-[var(--concept-field)] px-6 pt-7 pb-5 text-[var(--concept-ink)]"
    >
      <h1 tabIndex={-1} className="flex flex-col gap-2 outline-offset-4">
        <span className="text-[15px] leading-none">{customerCopy.brunch}</span>
        <span
          className={cn("leading-none", FACES[theme.face])}
          style={{ fontSize: theme.headerSize }}
        >
          <bdi>{conceptName}</bdi>
        </span>
      </h1>
      <p className="mt-3.5 text-base">
        <time dateTime={startsAt}>
          <span className="sr-only">{formatAccessibleDateTime(startsAt)}</span>
          <span aria-hidden>{formatSessionDateTime(startsAt)}</span>
        </time>
      </p>
      {children && <div className="mt-4 flex flex-wrap gap-2">{children}</div>}
    </header>
  )
}
