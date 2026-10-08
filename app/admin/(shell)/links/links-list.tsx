"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { LinkShare, whatsappShareHref } from "@/components/admin/link-share"
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

// The error of a row action. LINK_USED here means the customer joined while
// the list was open: the screen's own wording, and the list reloads.
export function rowErrorMessage(code: ErrorCode): string {
  return code === "LINK_USED" ? copy.linkUsed : errorMessage(code)
}

// A replacement link, shown once (AD-10).
export type ReplacedLink = {
  paymentId: string
  link: string | null
  linkExpiresAt: string
}

// The result of the latest action on the screen. One at a time: the next
// action (any revoke, replace or error on any row) or leaving the page
// replaces it, so a replacement panel disappears and its link reads as a
// normal row (phone test, user decision 2026-10-03).
export type Result =
  | { kind: "revoked" }
  | { kind: "sent" }
  | { kind: "replaced"; replaced: ReplacedLink }
  | { kind: "error"; tokenId: string; code: ErrorCode }

export function resultOf(
  action: "revoke" | "replace" | "send",
  item: Pick<LinkItem, "tokenId" | "paymentId">,
  answer:
    | { ok: true; data?: { link: string | null; linkExpiresAt: string } }
    | { ok: false; code: ErrorCode }
): Result {
  if (!answer.ok)
    return { kind: "error", tokenId: item.tokenId, code: answer.code }
  if (action === "revoke" || !answer.data) return { kind: "revoked" }
  // Sent: the new link went to WhatsApp and is not shown (AD-10). Without a
  // link (a repeat of the same key) it reads like a replacement that cannot
  // be shown.
  if (action === "send" && answer.data.link) return { kind: "sent" }
  return {
    kind: "replaced",
    replaced: { paymentId: item.paymentId, ...answer.data },
  }
}

// "Send on WhatsApp" on a row: a link that can be replaced and is still
// waiting (pending, also expired, awaiting_login, conflict or stuck).
export function canSend(item: Pick<LinkItem, "canReplace" | "status">) {
  return (
    item.canReplace && (item.status === "pending" || item.status === "expired")
  )
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
  const [busy, setBusy] = useState<{
    tokenId: string
    action: "replace" | "send" | "revoke"
  } | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (result && result.kind !== "error") noticeRef.current?.focus()
  }, [result])

  const confirming = items.find((item) => item.tokenId === confirmId)

  const revoke = (item: LinkListItem) => {
    if (pending) return
    setBusy({ tokenId: item.tokenId, action: "revoke" })
    setResult(null)
    startTransition(async () => {
      const answer = await revokeLinkAction({
        tokenId: item.tokenId,
        idempotencyKey: item.revokeKey,
      })
      setConfirmId(null)
      setBusy(null)
      setResult(resultOf("revoke", item, answer))
      if (answer.ok || answer.code === "LINK_USED") router.refresh()
    })
  }

  const replace = (item: LinkListItem) => {
    if (pending) return
    setBusy({ tokenId: item.tokenId, action: "replace" })
    setResult(null)
    startTransition(async () => {
      const answer = await replaceLinkAction({
        paymentId: item.paymentId,
        idempotencyKey: item.replaceKey,
      })
      setBusy(null)
      setResult(resultOf("replace", item, answer))
      if (answer.ok || answer.code === "LINK_USED") router.refresh()
    })
  }

  // One tap: replace the link and open WhatsApp with the new one. The window
  // opens inside the click (a phone blocks a pop-up opened after an await)
  // and gets its address when the link exists; without a window the page
  // itself goes to WhatsApp.
  const send = (item: LinkListItem) => {
    if (pending) return
    const target = window.open("", "_blank")
    // No way back to this page from WhatsApp's tab (as rel="noopener").
    if (target) target.opener = null
    setBusy({ tokenId: item.tokenId, action: "send" })
    setResult(null)
    startTransition(async () => {
      const answer = await replaceLinkAction({
        paymentId: item.paymentId,
        idempotencyKey: item.replaceKey,
      })
      setBusy(null)
      setResult(resultOf("send", item, answer))
      if (answer.ok && answer.data.link) {
        const href = whatsappShareHref(answer.data.link)
        if (target) target.location.href = href
        else window.location.href = href
      } else {
        target?.close()
      }
      if (answer.ok || answer.code === "LINK_USED") router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {(result?.kind === "revoked" || result?.kind === "sent") && (
        <div ref={noticeRef} tabIndex={-1} className="outline-none">
          <InlineNotice tone="success">
            {result.kind === "sent" ? copy.sent : copy.revoked}
          </InlineNotice>
        </div>
      )}

      {result?.kind === "replaced" && (
        <ReplacedPanel replaced={result.replaced} panelRef={noticeRef} />
      )}

      {items.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => {
            const busyWith = busy?.tokenId === item.tokenId ? busy.action : null
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
                    {canSend(item) && (
                      <Button
                        type="button"
                        className={BUTTON}
                        aria-busy={busyWith === "send" || undefined}
                        aria-disabled={pending || undefined}
                        onClick={() => send(item)}
                      >
                        {busyWith === "send" && <Spinner aria-hidden />}
                        {adminCopy.payments.sendWhatsapp}
                      </Button>
                    )}
                    {item.canReplace && (
                      <Button
                        type="button"
                        variant="outline"
                        className={BUTTON}
                        aria-busy={busyWith === "replace" || undefined}
                        aria-disabled={pending || undefined}
                        onClick={() => replace(item)}
                      >
                        {busyWith === "replace" && <Spinner aria-hidden />}
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
            <AlertDialogTitle className="font-heading text-[22px] leading-[1.25] font-light">
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
