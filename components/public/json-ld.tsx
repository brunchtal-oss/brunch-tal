import { jsonLdString } from "@/lib/seo/structured-data"

// Structured data as a native <script> (Next.js JSON-LD guide,
// fix-search-ready). jsonLdString writes every "<" as the escape u003c (with
// a backslash), so published text can never close the tag.
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdString(data) }}
    />
  )
}
