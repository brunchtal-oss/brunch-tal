"use client"

import { useEffect, useId, useRef, useState } from "react"
import Image from "next/image"
import { ImagePlusIcon } from "lucide-react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ActionResult } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import {
  ACCEPT,
  MAX_UPLOAD_BYTES,
  checkSource,
  cropFrame,
  moveFocus,
  resizeToJpeg,
} from "@/lib/media/resize"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

const copy = adminCopy.image

// The value the field edits (content: {media_id, alt?, focus_x, focus_y}).
export type ImageFieldValue = {
  media_id: string
  alt: string
  focus_x: number
  focus_y: number
}

type Problem =
  "notSupported" | "tooLarge" | "uploadFailed" | "unreadable" | { code: string }

// A file waiting for a retry (its row exists; only the upload failed).
type Pending = { mediaId: string; blob: Blob }

const OUTLINE =
  "h-11 rounded-[4px] border-foreground bg-transparent px-4 text-[15px]"

// DESIGN › image-upload-field (story 5.4): choose a file (type checked, the
// browser shrinks it to 2000px and a JPEG, which also drops EXIF), upload it
// to media-drafts/<id> (admin_create_media gives the id), then the preview
// with the focus point: a tap on the photo moves it (no arrows, user
// decision 2026-10-06), and the frame shows what the phone shows (outside it the photo is
// dimmed). Then "alt text (recommended)": not required (user decision
// 2026-10-05); empty is alt="". The file is never cropped. Nothing is public
// until the page (or the session) is published.
export function ImageUploadField({
  id,
  label,
  hint,
  altHint = copy.altHint,
  aspectRatio,
  value,
  previewUrl,
  error,
  onChange,
  createMedia,
  removable = true,
}: {
  id: string
  label: string
  hint?: string
  altHint?: string
  // width / height of the main place the image is shown; none: shown whole
  // (a screenshot), no focus point.
  aspectRatio?: number
  value: ImageFieldValue | null
  // The saved image's draft file (a signed URL); missing when the file never
  // arrived.
  previewUrl?: string | null
  error?: string | null
  onChange: (next: ImageFieldValue | null) => void
  createMedia: (input: {
    idempotencyKey: string
  }) => Promise<ActionResult<{ mediaId: string }>>
  // false inside a list item, where deleting the item removes the image
  // (user decision 2026-10-06: a second remove button there confuses).
  removable?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const altHintId = useId()
  const errorId = useId()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  // Object URLs of files uploaded in this visit, by media id.
  const [local, setLocal] = useState<Record<string, string>>({})
  const [ratio, setRatio] = useState<number | null>(null)
  const [announce, setAnnounce] = useState("")

  useEffect(
    () => () => {
      for (const url of Object.values(local)) URL.revokeObjectURL(url)
    },
    // Revoked once, when the field goes away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const src = value ? (local[value.media_id] ?? previewUrl ?? null) : null
  const missingFile = value !== null && src === null

  async function upload(mediaId: string, blob: Blob): Promise<boolean> {
    const { error: uploadError } = await createClient()
      .storage.from("media-drafts")
      .upload(mediaId, blob, {
        contentType: "image/jpeg",
        // A deleted public copy leaves the CDN within 10 minutes.
        cacheControl: "600",
        upsert: false,
      })
    // "already exists": an earlier try arrived but its answer was lost, so
    // the file is there (the name is the row's own id).
    const arrived =
      uploadError &&
      ((uploadError as { statusCode?: string }).statusCode === "409" ||
        /already exists|duplicate/i.test(uploadError.message))
    if (uploadError && !arrived) {
      setPending({ mediaId, blob })
      setProblem("uploadFailed")
      return false
    }
    setPending(null)
    const url = URL.createObjectURL(blob)
    setLocal((current) => ({ ...current, [mediaId]: url }))
    setRatio(null)
    onChange({ media_id: mediaId, alt: "", focus_x: 50, focus_y: 50 })
    setAnnounce(copy.uploaded)
    return true
  }

  async function onFile(file: File) {
    setProblem(null)
    setPending(null)
    const before = checkSource(file)
    if (before) {
      setProblem(before)
      return
    }
    setBusy(true)
    try {
      let blob: Blob
      try {
        blob = await resizeToJpeg(file)
      } catch {
        setProblem("unreadable")
        return
      }
      if (blob.size > MAX_UPLOAD_BYTES) {
        setProblem("tooLarge")
        return
      }
      const created = await createMedia({
        idempotencyKey: newIdempotencyKey(),
      })
      if (!created.ok) {
        setProblem({ code: created.code })
        return
      }
      await upload(created.data.mediaId, blob)
    } catch {
      setProblem("uploadFailed")
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function retry() {
    if (!pending || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await upload(pending.mediaId, pending.blob)
    } catch {
      setProblem("uploadFailed")
    } finally {
      setBusy(false)
    }
  }

  function setFocus(focusX: number, focusY: number) {
    if (!value) return
    onChange({ ...value, focus_x: focusX, focus_y: focusY })
    setAnnounce(copy.focusAt(focusX, focusY))
  }

  const problemText =
    problem === null
      ? null
      : typeof problem === "object"
        ? errorMessage(problem.code)
        : copy[problem]

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ")

  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy || undefined}
      className="flex flex-col gap-3"
    >
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      {hint && (
        <p id={hintId} className="-mt-2 text-[13px] text-muted-foreground">
          {hint}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <input
        ref={inputRef}
        id={`${id}-file`}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void onFile(file)
        }}
      />

      {value === null ? (
        <button
          id={id}
          type="button"
          onClick={() => inputRef.current?.click()}
          aria-busy={busy || undefined}
          aria-describedby={describedBy || undefined}
          data-focus-error={error ? true : undefined}
          className={cn(
            "flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground bg-card p-5 text-center outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
            error && "border-error"
          )}
        >
          {busy ? (
            <>
              <Spinner aria-hidden className="size-6" />
              <span className="text-base">{copy.uploading}</span>
            </>
          ) : (
            <>
              <ImagePlusIcon
                aria-hidden
                strokeWidth={1.25}
                className="size-8 text-brand-accent"
              />
              <span className="text-base font-semibold">{copy.choose}</span>
              <span className="text-[13px] text-pretty text-muted-foreground">
                {copy.chooseHint}
              </span>
            </>
          )}
        </button>
      ) : (
        <div className="flex flex-col gap-4">
          {src ? (
            <FocusPreview
              src={src}
              aspectRatio={aspectRatio}
              focusX={value.focus_x}
              focusY={value.focus_y}
              ratio={ratio}
              onRatio={setRatio}
              onFocus={setFocus}
            />
          ) : null}

          {missingFile && (
            <InlineNotice tone="warning">{copy.notUploaded}</InlineNotice>
          )}

          {src && aspectRatio !== undefined && (
            <div className="flex flex-col gap-2">
              <p className="text-[15px] font-semibold">{copy.focusTitle}</p>
              <p className="-mt-1 text-[13px] text-pretty text-muted-foreground">
                {copy.focusHint}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-alt`} className="text-sm font-medium">
              {copy.alt}
            </label>
            <input
              id={`${id}-alt`}
              type="text"
              value={value.alt}
              maxLength={300}
              autoComplete="off"
              aria-describedby={altHintId}
              onChange={(event) =>
                onChange({ ...value, alt: event.target.value })
              }
              className="h-12 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <p
              id={altHintId}
              className="text-[13px] text-pretty text-muted-foreground"
            >
              {altHint}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              id={id}
              type="button"
              variant="outline"
              className={OUTLINE}
              aria-busy={busy || undefined}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) inputRef.current?.click()
              }}
            >
              {busy && <Spinner aria-hidden />}
              {copy.replace}
            </Button>
            {removable && (
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-2 text-[15px] font-normal underline underline-offset-[3px] hover:bg-muted"
                onClick={() => {
                  onChange(null)
                  setProblem(null)
                  setPending(null)
                }}
              >
                {copy.remove}
              </Button>
            )}
          </div>
        </div>
      )}

      {problemText && (
        <InlineNotice
          tone="error"
          actions={
            pending ? (
              <Button
                type="button"
                variant="outline"
                className={OUTLINE}
                aria-busy={busy || undefined}
                onClick={() => void retry()}
              >
                {busy && <Spinner aria-hidden />}
                {copy.retry}
              </Button>
            ) : undefined
          }
        >
          {problemText}
        </InlineNotice>
      )}

      {error && (
        <p id={errorId} className="text-[15px] text-error">
          {error}
        </p>
      )}
    </div>
  )
}

// The photo, whole, with the focus point and (with an aspect) the frame of
// what the site shows; outside the frame it is dimmed (scrim-ink 40%). A tap
// sets the focus point (the arrows do the same from the keyboard).
function FocusPreview({
  src,
  aspectRatio,
  focusX,
  focusY,
  ratio,
  onRatio,
  onFocus,
}: {
  src: string
  aspectRatio?: number
  focusX: number
  focusY: number
  ratio: number | null
  onRatio: (ratio: number) => void
  onFocus: (focusX: number, focusY: number) => void
}) {
  const frame =
    aspectRatio !== undefined && ratio
      ? cropFrame(ratio, aspectRatio, focusX, focusY)
      : null
  return (
    <div
      dir="ltr"
      // A tall photo is narrowed so the whole of it fits the screen; the box
      // is always exactly the photo, so the frame and the point line up.
      style={
        ratio
          ? { width: `min(100%, 420px, calc(60svh * ${ratio}))` }
          : undefined
      }
      className={cn(
        "relative mx-auto w-full max-w-[420px] overflow-hidden rounded-lg bg-muted",
        aspectRatio !== undefined && "cursor-crosshair touch-manipulation"
      )}
      onClick={(event) => {
        if (aspectRatio === undefined) return
        const rect = event.currentTarget.getBoundingClientRect()
        const x = ((event.clientX - rect.left) / rect.width) * 100
        const y = ((event.clientY - rect.top) / rect.height) * 100
        onFocus(moveFocus(x, 0), moveFocus(y, 0))
      }}
    >
      <Image
        src={src}
        alt={adminCopy.image.previewAlt}
        width={800}
        height={800}
        unoptimized
        onLoad={(event) => {
          const img = event.currentTarget
          if (img.naturalWidth && img.naturalHeight) {
            onRatio(img.naturalWidth / img.naturalHeight)
          }
        }}
        className="block h-auto w-full select-none"
        draggable={false}
      />
      {frame && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-[2px] border-2 border-primary shadow-[0_0_0_9999px_rgb(46_42_31/0.4)]"
          style={{
            left: `${frame.left}%`,
            top: `${frame.top}%`,
            width: `${frame.width}%`,
            height: `${frame.height}%`,
          }}
        />
      )}
      {aspectRatio !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-[0_0_0_2px_var(--color-primary)]"
          style={{ left: `${focusX}%`, top: `${focusY}%` }}
        />
      )}
    </div>
  )
}
