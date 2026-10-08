"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { buttonVariants, Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import { publishContentAction } from "./actions"

const copy = adminCopy.content

// The fixed bar of a preview (EXPERIENCE › site content › preview): "not
// published yet", back to the editor, and publish when there is a pending
// draft. An editor page can span more than one slug (home and about), so
// publish publishes each slug with a pending draft, each with its own key
// (AD-5); a key is kept until its slug is published, so a retry publishes
// once. The answer replaces the bar's line (aria-live).
export function PreviewBar({
  backHref,
  pending,
  blocked = [],
}: {
  backHref: string
  // The accessibility statement before its first publish (story 5.5): the
  // missing required fields, each linking to its field in the editor;
  // "publish" is aria-disabled while there is one.
  blocked?: readonly { label: string; href: string }[]
  // The slugs with a pending draft and their publish keys.
  pending: readonly { slug: string; publishKey: string }[]
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [keys, setKeys] = useState(() =>
    Object.fromEntries(pending.map((item) => [item.slug, item.publishKey]))
  )
  const [left, setLeft] = useState(() => pending.map((item) => item.slug))
  const [line, setLine] = useState<string | null>(null)

  const publish = () => {
    if (busy) return
    startTransition(async () => {
      let changed = 0
      const remaining = [...left]
      // A failure after some slugs were published: those are live, so the
      // page is refreshed and the line says so; the rest (and their keys)
      // stay for a retry.
      const stop = (error: string) => {
        setLeft(remaining)
        const someDone = remaining.length < left.length
        setLine(someDone ? copy.partlyPublished(error) : error)
        if (someDone) router.refresh()
      }
      for (const slug of left) {
        let answer: Awaited<ReturnType<typeof publishContentAction>>
        try {
          answer = await publishContentAction({
            slug,
            idempotencyKey: keys[slug],
          })
        } catch {
          // A thrown Server Action (network drop); the key is kept for a retry.
          stop(errorMessage("SERVER_ERROR"))
          return
        }
        if (!answer.ok) {
          stop(
            answer.code === "INVALID_INPUT"
              ? copy.draftInvalid
              : errorMessage(answer.code)
          )
          return
        }
        changed += answer.data.changed
        remaining.splice(remaining.indexOf(slug), 1)
        setKeys((current) => ({ ...current, [slug]: newIdempotencyKey() }))
      }
      setLeft([])
      setLine(changed > 0 ? copy.published : copy.nothingToPublish)
      router.refresh()
    })
  }

  const hasPending = pending.length > 0
  const isBlocked = blocked.length > 0
  const showPublish = left.length > 0 || isBlocked

  return (
    <div className="sticky top-0 z-20 -mx-6 bg-primary px-6 py-3 text-primary-foreground">
      <div className="flex flex-col gap-3">
        <p aria-live="polite" className="text-[15px] font-semibold">
          {line ?? (hasPending ? copy.previewBar : copy.previewNoChanges)}
        </p>
        {isBlocked && (
          <InlineNotice
            tone="warning"
            actions={
              <ul className="flex flex-wrap justify-center gap-x-4">
                {blocked.map((field) => (
                  <li key={field.href}>
                    <Link
                      href={field.href}
                      className="inline-flex min-h-11 items-center underline underline-offset-4"
                    >
                      {field.label}
                    </Link>
                  </li>
                ))}
              </ul>
            }
          >
            <span id="preview-publish-blocked">{copy.statement.blocked}</span>
          </InlineNotice>
        )}
        <div className="flex flex-wrap gap-3">
          <Link
            href={backHref}
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
              onClick={isBlocked ? undefined : publish}
              aria-busy={busy || undefined}
              aria-disabled={busy || isBlocked || undefined}
              aria-describedby={
                isBlocked ? "preview-publish-blocked" : undefined
              }
              className="h-11 rounded-[4px] bg-background px-6 text-[15px] font-semibold text-foreground hover:bg-background/90 aria-disabled:opacity-60"
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
