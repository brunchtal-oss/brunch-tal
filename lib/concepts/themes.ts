// The concept themes (CAP-41, AD-16): the database keeps only
// concepts.theme_key and generic_paper_key; the design values live here,
// from DESIGN.md › Colors (concept colours) and Typography (concept-name-*).
// A field ("paper") and its dark ink: the ink is used for every text on the
// field, never cream text. The face is used only for the concept name, at
// 22px and up. Loaded fonts: components/shared/concept-header.tsx.

export const THEME_KEYS = [
  "mothers",
  "couples",
  "grandma",
  "grandpa",
  "greek",
  "generic",
] as const
export type ThemeKey = (typeof THEME_KEYS)[number]

export const PAPER_KEYS = [
  "olive",
  "plum",
  "jade",
  "mustard",
  "slate",
  "clay",
] as const
export type PaperKey = (typeof PAPER_KEYS)[number]

// heebo is the heading face of the whole site (--font-heading).
export type ConceptFace =
  "heebo" | "bona-nova" | "david-libre" | "frank-ruhl-libre" | "suez-one"

export type ConceptTheme = {
  field: string
  ink: string
  face: ConceptFace
  // The name's size in the concept-header (DESIGN: 40-46px by face).
  headerSize: number
}

type Paper = { field: string; ink: string }

export const PAPERS: Record<PaperKey, Paper> = {
  olive: { field: "#D0CEB2", ink: "#3D3D22" },
  plum: { field: "#CDBBCF", ink: "#46304A" },
  jade: { field: "#B9CFCA", ink: "#233F3B" },
  mustard: { field: "#E2CF9E", ink: "#4E3A12" },
  slate: { field: "#C3CAD3", ink: "#2E3742" },
  clay: { field: "#DDB9AC", ink: "#5A2C1F" },
}

export const THEMES: Record<Exclude<ThemeKey, "generic">, ConceptTheme> = {
  mothers: { field: "#CDD3BC", ink: "#3C4631", face: "heebo", headerSize: 40 },
  couples: {
    field: "#D3CCE0",
    ink: "#3B3350",
    face: "bona-nova",
    headerSize: 46,
  },
  grandma: {
    field: "#F0E2B6",
    ink: "#5A4513",
    face: "david-libre",
    headerSize: 40,
  },
  grandpa: {
    field: "#D2C0A6",
    ink: "#3E2E20",
    face: "frank-ruhl-libre",
    headerSize: 40,
  },
  greek: { field: "#BDD0DC", ink: "#1C3A4F", face: "suez-one", headerSize: 42 },
}

function isKey<K extends string>(
  keys: readonly K[],
  value: string | null | undefined
): value is K {
  return (
    typeof value === "string" && (keys as readonly string[]).includes(value)
  )
}

/**
 * The theme of a concept. generic takes its paper (olive when missing); an
 * unknown key (a theme added in the database before the code) is shown as
 * the generic olive paper, never without a field.
 */
export function conceptTheme(
  themeKey: string | null | undefined,
  paperKey?: string | null
): ConceptTheme {
  if (isKey(THEME_KEYS, themeKey) && themeKey !== "generic") {
    return THEMES[themeKey]
  }
  const paper = PAPERS[isKey(PAPER_KEYS, paperKey) ? paperKey : "olive"]
  return { ...paper, face: "heebo", headerSize: 40 }
}
