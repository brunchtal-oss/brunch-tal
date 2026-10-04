"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { buttonVariants, Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

import { publishContentAction } from "../../actions"

const copy = adminCopy.content

// The fixed bar of the preview (EXPERIENCE › site content › preview): "not
// published yet", back to the editor, and publish when there is a pending
// draft. The answer replaces the bar's line (aria-live).
export function PreviewBar({
  hasPending,
  publishKey,
}: {
  hasPending: boolean
  publishKey: string
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [key, setKey] = useState(publishKey)
  const [line, setLine] = useState<string | null>(null)
  const [published, setPublished] = useState(false)

  const publish = () => {
    if (busy) return
    startTransition(async () => {
      let answer: Awaited<ReturnType<typeof publishContentAction>>
      try {
        answer = await publishContentAction({
          slug: "home",
          idempotencyKey: key,
        })
      } catch {
        // A thrown Server Action (network drop); the key is kept for a retry.
        setLine(errorMessage("SERVER_ERROR"))
        return
      }
      if (!answer.ok) {
        setLine(
          answer.code === "INVALID_INPUT"
            ? copy.draftInvalid
            : errorMessage(answer.code)
        )
        return
      }
      setKey(crypto.randomUUID())
      setPublished(true)
      setLine(answer.data.changed > 0 ? copy.published : copy.nothingToPublish)
      router.refresh()
    })
  }

  const showPublish = hasPending && !published

  return (
    <div className="sticky top-0 z-20 -mx-6 bg-primary px-6 py-3 text-primary-foreground">
      <div className="flex flex-col gap-3">
        <p aria-live="polite" className="text-[15px] font-semibold">
          {line ?? (hasPending ? copy.previewBar : copy.previewNoChanges)}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/content/home"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-11 rounded-[4px] border-primary-foreground bg-transparent px-4 text-[15px] font-semibold text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            )}
          >
            {copy.backToEdit}
          </Link>
          {showPublish && (
            <Button
              type="button"
              onClick={publish}
              aria-busy={busy || undefined}
              aria-disabled={busy || undefined}
              className="h-11 rounded-[4px] bg-background px-5 text-[15px] font-semibold text-foreground hover:bg-background/90"
            >
              {busy && <Spinner aria-hidden />}
              {copy.publish}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
