"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { LinkShare } from "@/components/admin/link-share"
import { InlineNotice } from "@/components/shared/inline-notice"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { formatSessionDateTime } from "@/lib/time"
import { cn } from "@/lib/utils"

import { replaceLinkAction, revokeLinkAction } from "./actions"
import type { LinkItem, LinkStatus } from "./link-items"

const copy = adminCopy.links
const BUTTON = "h-11 text-base"

export type LinkListItem = LinkItem & { revokeKey: string; replaceKey: string }

// DESIGN.md › status-chip: pending for a waiting link, success once used,
// expired (muted, not red) for expired and revoked.
const CHIP: Record<LinkStatus, { chip: string; dot: string }> = {
  pending: { chip: "bg-pending-tint text-pending", dot: "bg-pending-dot" },
  consumed: { chip: "bg-success-tint text-success", dot: "bg-success-dot" },
  expired: { chip: "bg-expired-tint text-expired", dot: "bg-expired-dot" },
  revoked: { chip: "bg-expired-tint text-expired", dot: "bg-expired-dot" },
}

function StatusChip({ status, label }: { status: LinkStatus; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold",
        CHIP[status].chip
      )}
    >
      <span
        aria-hidden
        className={cn("size-[7px] rounded-full", CHIP[status].dot)}
      />
      {label}
    </span>
  )
}

type Result =
  { kind: "revoked" } | { kind: "error"; tokenId: string; code: ErrorCode }

// A replacement link, shown once (AD-10). Kept apart from the other results,
// so a later action on another row never hides it; only a new replacement
// of the same payment takes its place (or a page reload).
// The error of a row action. LINK_USED here means the customer joined while
// the list was open: the screen's own wording, and the list reloads.
export function rowErrorMessage(code: ErrorCode): string {
  return code === "LINK_USED" ? copy.linkUsed : errorMessage(code)
}

export type ReplacedLink = {
  paymentId: string
  link: string | null
  linkExpiresAt: string
}

export function withReplaced(
  shown: readonly ReplacedLink[],
  entry: ReplacedLink
): ReplacedLink[] {
  return [entry, ...shown.filter((e) => e.paymentId !== entry.paymentId)]
}

// The panel of one replacement: the notice, the validity (as on the card
// after a payment approval) and the send and copy buttons.
export function ReplacedPanel({
  replaced,
  panelRef,
}: {
  replaced: ReplacedLink
  panelRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="flex flex-col gap-4 outline-none"
    >
      <InlineNotice tone="success">{copy.replaced}</InlineNotice>
      {replaced.link ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-4 py-4">
          <p className="text-[15px]">
            {adminCopy.payments.linkValidUntil}{" "}
            <time dateTime={replaced.linkExpiresAt}>
              <bdi>{formatSessionDateTime(replaced.linkExpiresAt)}</bdi>
            </time>
          </p>
          <LinkShare link={replaced.link} />
        </div>
      ) : (
        <InlineNotice tone="warning">
          {adminCopy.payments.linkNotShown}
        </InlineNotice>
      )}
    </div>
  )
}

// /admin/links (story 2.4): the join links, newest first, as rows with a
// divider (DESIGN › content-section-row). Revoke asks a short confirmation;
// replace issues a new link at once and shows it for sending, once (AD-10).
// The result is an inline-notice at the top of the list; the list then
// reloads from the server (no optimistic change).
export function LinksList({ items }: { items: readonly LinkListItem[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [replaced, setReplaced] = useState<readonly ReplacedLink[]>([])
  const noticeRef = useRef<HTMLDivElement>(null)
  const replacedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (result?.kind === "revoked") noticeRef.current?.focus()
  }, [result])

  // The newest replacement is first.
  useEffect(() => {
    if (replaced.length) replacedRef.current?.focus()
  }, [replaced])

  const confirming = items.find((item) => item.tokenId === confirmId)

  const revoke = (item: LinkListItem) => {
    if (pending) return
    setBusyId(item.tokenId)
    startTransition(async () => {
      const answer = await revokeLinkAction({
        tokenId: item.tokenId,
        idempotencyKey: item.revokeKey,
      })
      setConfirmId(null)
      setBusyId(null)
      if (answer.ok) {
        setResult({ kind: "revoked" })
        router.refresh()
      } else {
        setResult({ kind: "error", tokenId: item.tokenId, code: answer.code })
        if (answer.code === "LINK_USED") router.refresh()
      }
    })
  }

  const replace = (item: LinkListItem) => {
    if (pending) return
    setBusyId(item.tokenId)
    startTransition(async () => {
      const answer = await replaceLinkAction({
        paymentId: item.paymentId,
        idempotencyKey: item.replaceKey,
      })
      setBusyId(null)
      if (answer.ok) {
        setResult(null)
        setReplaced((shown) =>
          withReplaced(shown, { paymentId: item.paymentId, ...answer.data })
        )
        router.refresh()
      } else {
        setResult({ kind: "error", tokenId: item.tokenId, code: answer.code })
        if (answer.code === "LINK_USED") router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {result?.kind === "revoked" && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          <InlineNotice tone="success">{copy.revoked}</InlineNotice>
        </div>
      )}

      {replaced.map((entry, index) => (
        <ReplacedPanel
          key={entry.paymentId}
          replaced={entry}
          panelRef={index === 0 ? replacedRef : undefined}
        />
      ))}

      {items.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => {
            const busy = busyId === item.tokenId
            const error =
              result?.kind === "error" && result.tokenId === item.tokenId
                ? result.code
                : null
            return (
              <li
                key={item.tokenId}
                className="flex flex-col gap-3 border-b border-border py-4 first:pt-0 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-base font-semibold">{item.title}</p>
                    <p className="text-[15px] text-muted-foreground">
                      <bdi>{item.purchase}</bdi>
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      <time dateTime={item.timeAt}>
                        <bdi>{item.timeLine}</bdi>
                      </time>
                    </p>
                    {item.detail && (
                      <p
                        className={cn(
                          "text-[15px]",
                          item.detail.attention && "text-warning"
                        )}
                      >
                        {item.detail.text}
                      </p>
                    )}
                  </div>
                  <StatusChip status={item.status} label={item.statusLabel} />
                </div>

                {error && (
                  <InlineNotice tone="error">
                    {rowErrorMessage(error)}
                  </InlineNotice>
                )}

                {(item.canRevoke || item.canReplace) && (
                  <div className="flex flex-wrap gap-3">
                    {item.canReplace && (
                      <Button
                        type="button"
                        variant="outline"
                        className={BUTTON}
                        aria-busy={busy || undefined}
                        aria-disabled={pending || undefined}
                        onClick={() => replace(item)}
                      >
                        {busy && !confirmId && <Spinner aria-hidden />}
                        {copy.replace}
                      </Button>
                    )}
                    {item.canRevoke && (
                      <Button
                        type="button"
                        variant="ghost"
                        className={BUTTON}
                        aria-disabled={pending || undefined}
                        onClick={() => {
                          if (!pending) setConfirmId(item.tokenId)
                        }}
                      >
                        {copy.revoke}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[20px] font-light">
              {copy.confirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[15px]">
              {copy.confirmBody}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={BUTTON} disabled={pending}>
              {copy.confirmBack}
            </AlertDialogCancel>
            <Button
              type="button"
              className={BUTTON}
              aria-busy={pending || undefined}
              aria-disabled={pending || undefined}
              onClick={() => confirming && revoke(confirming)}
            >
              {pending && <Spinner aria-hidden />}
              {copy.confirmYes}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
