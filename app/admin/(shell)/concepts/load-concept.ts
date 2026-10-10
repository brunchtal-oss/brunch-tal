import type { ConceptImage, ConceptKind, ConceptRow } from "./concept-draft"

// The columns the concept screens read (public.concepts, readable by
// everyone; media_assets: the admin reads every row) with the concept's
// image. The list orders them as the session form does (sort_order, name).
export const CONCEPT_COLUMNS =
  "id, name, description, default_kind, archived_at, image:media_assets!concepts_default_image_id_fkey(id, public_path, alt_text, focus_x, focus_y, publish_state)"

// The generated row types its checked text columns as string; the table's
// check guarantees the kind.
export function toConceptRow(row: {
  id: string
  name: string
  description: string | null
  default_kind: string
  archived_at: string | null
  image?: {
    id: string
    public_path: string
    alt_text: string | null
    focus_x: number
    focus_y: number
    publish_state: string
  } | null
}): ConceptRow {
  const { image, ...rest } = row
  const conceptImage: ConceptImage | null = image
    ? {
        media_id: image.id,
        alt: image.alt_text ?? "",
        focus_x: image.focus_x,
        focus_y: image.focus_y,
      }
    : null
  return {
    ...rest,
    default_kind: rest.default_kind as ConceptKind,
    image: conceptImage,
    image_path:
      image && image.publish_state === "published" ? image.public_path : null,
  }
}
