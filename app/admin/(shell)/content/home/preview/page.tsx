import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"

import { HomeHero } from "@/components/public/home-hero"
import { heroSchema } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { hasPendingDraft, sectionOf } from "../../content-items"
import { loadContentPage } from "../../load-page"
import { PreviewBar } from "./preview-bar"

export const metadata: Metadata = {
  title: adminCopy.content.previewTitle,
}

// /admin/content/home/preview (story 5.1): the home page's hero component
// with the saved draft (else what is published), under the fixed bar
// "preview, not published yet". Dynamic, admin only, never cached (AD-16):
// the draft is read with the admin's session.
export default function HomePreviewPage() {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <Preview />
    </Suspense>
  )
}

async function Preview() {
  const page = await loadContentPage("home")
  const section = sectionOf(page, "hero")
  const pending = section ? hasPendingDraft(section) : false
  const content = pending ? section?.draft_content : section?.published_content
  const parsed = heroSchema.safeParse(content)

  return (
    <div className="flex min-h-[70svh] flex-col">
      <PreviewBar slug="home" hasPending={pending} publishKey={randomUUID()} />
      <div className="-mx-6 flex flex-1 flex-col border-b border-border">
        <HomeHero hero={parsed.success ? parsed.data : null} />
      </div>
    </div>
  )
}
