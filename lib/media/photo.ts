// Published images on the site (story 5.4, AD-16). Pure: the URL of a
// published file and a session's photo from its joined rows. The site reads
// an image only through a join to media_assets, whose RLS shows anon only
// published rows (and only the display columns), so an image that is not
// published arrives as null and is not shown.

// The bucket of published files (public URL, no listing).
export const PUBLIC_BUCKET = "media-public"

// The public URL of a published file (media_assets.public_path).
export function publicMediaUrl(
  publicPath: string,
  baseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): string {
  const base = (baseUrl ?? "").replace(/\/+$/, "")
  return `${base}/storage/v1/object/public/${PUBLIC_BUCKET}/${encodeURIComponent(publicPath)}`
}

// The columns of an image the site reads.
const IMAGE_COLUMNS = "public_path, alt_text, focus_x, focus_y"

// The session's image and its concept's default image, for a select on
// events (with the concept's own columns).
export const SESSION_IMAGE_SELECT = `image:media_assets!events_image_id_fkey(${IMAGE_COLUMNS})`
export const CONCEPT_IMAGE_SELECT = `default_image:media_assets!concepts_default_image_id_fkey(${IMAGE_COLUMNS})`

export type MediaRow = {
  public_path: string
  alt_text: string | null
  focus_x: number
  focus_y: number
}

export type SessionPhotoData = {
  photoUrl: string
  photoAlt: string
  focusX: number
  focusY: number
}

// The session's photo, else its concept's; null when neither is published.
export function sessionPhoto(
  sessionImage: MediaRow | null | undefined,
  conceptImage: MediaRow | null | undefined,
  baseUrl?: string
): SessionPhotoData | null {
  const row = sessionImage ?? conceptImage
  if (!row) return null
  return {
    photoUrl: publicMediaUrl(row.public_path, baseUrl),
    photoAlt: row.alt_text ?? "",
    focusX: row.focus_x,
    focusY: row.focus_y,
  }
}

// CSS object-position of a focus point (percent from the physical left and
// top of the image; not a layout direction).
export function objectPosition(focusX: number, focusY: number): string {
  return `${focusX}% ${focusY}%`
}
