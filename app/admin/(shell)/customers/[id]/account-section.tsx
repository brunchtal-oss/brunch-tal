"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PencilIcon } from "lucide-react"

import { LinkShare } from "@/components/admin/link-share"
import {
  asSaveResult,
  ValueChangeRow,
} from "@/components/admin/value-change-row"
import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { formatSessionDateTime } from "@/lib/time"

import {
  changeEmailAction,
  changePhoneAction,
  issueResetLinkAction,
} from "./actions"
import {
  emailChange,
  ACTION_BUTTON,
  phoneChange,
  type AccountView,
} from "./card-items"

const copy = adminCopy.customers.card
const INPUT = "h-12 text-start text-base"

// The phone and the email at the top of the card's "פרטים" (story 2.8;
// fix 9, user decision 2026-10-19): each a row of the details' <dl>, and a
// pencil after the value opens its value-change-row under it (old and new,
// saved alone, logged; the email in two steps on the server, AD-21).
// Cancel or the pencil again closes the field; after a save it stays open
// with the saved text until closed. Nothing is optimistic: after a save
// the page reloads from the server. The email's pencil needs an activated
// account; a stuck change shows its notice with the email field open.
export function ContactRows({
  customerId,
  email,
  phone,
  view,
}: {
  customerId: string
  // As saved: the email from Auth, the phone as Tal reads it (local).
  email: string
  phone: string
  view: AccountView
}) {
  const [emailOpen, setEmailOpen] = useState(view.stuck && view.canChangeEmail)
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [emailDraft, setEmailDraft] = useState(email)
  const [phoneDraft, setPhoneDraft] = useState(phone)
  // Stuck after Auth took the address: the saved email is already the new
  // one, and saving it again finishes the change.
  const nextEmail = emailChange(email, emailDraft, view.stuck)
  const nextPhone = phoneChange(phone, phoneDraft)

  const closeEmail = () => {
    setEmailDraft(email)
    setEmailOpen(false)
  }
  const closePhone = () => {
    setPhoneDraft(phone)
    setPhoneOpen(false)
  }

  return (
    <>
      <ContactRow
        id="card-phone"
        label={copy.account.phone}
        value={phone}
        editLabel={copy.account.editPhone}
        open={phoneOpen}
        onToggle={() => (phoneOpen ? closePhone() : setPhoneOpen(true))}
      >
        <ValueChangeRow
          label={copy.account.phone}
          oldValue={phone}
          newValue={nextPhone}
          savedText={copy.account.phoneChanged}
          onSave={async (idempotencyKey) =>
            asSaveResult(
              await changePhoneAction({
                customerId,
                phone: nextPhone ?? "",
                idempotencyKey,
              })
            )
          }
          onCancel={closePhone}
        >
          <Field>
            <FieldLabel htmlFor="account-phone">
              {copy.account.changePhone}
            </FieldLabel>
            <Input
              id="account-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              dir="ltr"
              maxLength={40}
              value={phoneDraft}
              onChange={(event) => setPhoneDraft(event.target.value)}
              className={INPUT}
            />
          </Field>
        </ValueChangeRow>
      </ContactRow>
      {(email || view.canChangeEmail) && (
        <ContactRow
          id="card-email"
          label={copy.email}
          value={email}
          editLabel={view.canChangeEmail ? copy.account.editEmail : null}
          open={emailOpen}
          onToggle={() => (emailOpen ? closeEmail() : setEmailOpen(true))}
          notice={
            view.stuck ? (
              <InlineNotice tone="warning">
                {copy.account.emailChangeStuck}
              </InlineNotice>
            ) : null
          }
        >
          <ValueChangeRow
            label={copy.email}
            oldValue={email}
            newValue={nextEmail}
            savedText={copy.account.emailChanged}
            onSave={async (idempotencyKey) =>
              asSaveResult(
                await changeEmailAction({
                  customerId,
                  email: nextEmail ?? "",
                  idempotencyKey,
                })
              )
            }
            onCancel={closeEmail}
          >
            <Field>
              <FieldLabel htmlFor="account-email">
                {copy.account.changeEmail}
              </FieldLabel>
              <Input
                id="account-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                dir="ltr"
                maxLength={254}
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                className={INPUT}
              />
            </Field>
          </ValueChangeRow>
        </ContactRow>
      )}
    </>
  )
}

// One contact row: the label, the value (LTR) and its pencil (it only
// opens the field, so a plain button), then the notice and the open field.
// The field's box stays in the markup (hidden when closed) so aria-controls
// always names it; the field itself mounts on open, so closing drops its
// draft and its last answer.
export function ContactRow({
  id,
  label,
  value,
  editLabel,
  open,
  onToggle,
  notice,
  children,
}: {
  id: string
  label: string
  value: string
  // null: no pencil (the email of a customer not activated).
  editLabel: string | null
  open: boolean
  onToggle: () => void
  notice?: React.ReactNode
  children: React.ReactNode
}) {
  const panelId = `${id}-edit`
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-3">
        <span className="flex min-h-11 items-center gap-1">
          <bdi dir="ltr" className="min-w-0 text-base break-words">
            {value}
          </bdi>
          {editLabel && (
            <button
              type="button"
              aria-label={editLabel}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-foreground hover:bg-muted aria-expanded:bg-muted"
            >
              <PencilIcon aria-hidden strokeWidth={1.5} className="size-5" />
            </button>
          )}
        </span>
        {notice}
        <div id={panelId} hidden={!open}>
          {open && children}
        </div>
      </dd>
    </div>
  )
}

// The card's actions under "פרטים" (fix 9; phone check, user decision
// 2026-10-21): "הפקת קישור איפוס" beside the slot (the page's booking
// link), two equal columns, then after issuing the validity with "send on
// WhatsApp" and "copy the link" (shown once, AD-10). No line about the
// latest link. The reset button needs an activated account.
export function CardActions({
  customerId,
  view,
  children,
}: {
  customerId: string
  view: AccountView
  children?: React.ReactNode
}) {
  if (!view.canIssueReset) {
    return children ? (
      <div className="grid grid-cols-2 gap-2">{children}</div>
    ) : null
  }
  return <ResetLink customerId={customerId}>{children}</ResetLink>
}

export type Issued = { link: string | null; linkExpiresAt: string }

export type IssueAnswer =
  { ok: true; issued: Issued } | { ok: false; code: ErrorCode }

// One click of the reset button: sends `key` and tells which key the next
// click uses. A new key after every answer, ok or not (as value-change-row).
export async function issueResetWithKey(
  customerId: string,
  key: string
): Promise<{ answer: IssueAnswer; nextKey: string }> {
  let answer: IssueAnswer
  try {
    const result = await issueResetLinkAction({
      customerId,
      idempotencyKey: key,
    })
    answer = result.ok
      ? { ok: true, issued: result.data }
      : { ok: false, code: result.code }
  } catch {
    answer = { ok: false, code: "SERVER_ERROR" }
  }
  return { answer, nextKey: newIdempotencyKey() }
}

// The reset button's state; ResetLinkView draws it.
function ResetLink({
  customerId,
  children,
}: {
  customerId: string
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [pending, setPending] = useState(false)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [error, setError] = useState<ErrorCode | null>(null)

  const issue = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const { answer, nextKey } = await issueResetWithKey(customerId, key)
      setKey(nextKey)
      if (!answer.ok) {
        setError(answer.code)
        return
      }
      setIssued(answer.issued)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <ResetLinkView
      pending={pending}
      issued={issued}
      error={error}
      onIssue={issue}
    >
      {children}
    </ResetLinkView>
  )
}

export function ResetLinkView({
  pending,
  issued,
  error,
  onIssue,
  children,
}: {
  pending: boolean
  issued: Issued | null
  error: ErrorCode | null
  onIssue: () => void
  // Beside the button (the page's booking link).
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <OnlineButton
          type="button"
          size="lg"
          className={ACTION_BUTTON}
          aria-busy={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={onIssue}
        >
          {pending && <Spinner aria-hidden />}
          {copy.account.issueReset}
        </OnlineButton>
        {children}
      </div>
      {error && <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>}
      {issued &&
        (issued.link ? (
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-card px-4 py-4">
            <InlineNotice tone="success">
              {copy.account.resetReady}
            </InlineNotice>
            <p className="text-[15px]">
              {adminCopy.payments.linkValidUntil}{" "}
              <time dateTime={issued.linkExpiresAt}>
                <bdi>{formatSessionDateTime(issued.linkExpiresAt)}</bdi>
              </time>
            </p>
            <LinkShare link={issued.link} />
          </div>
        ) : (
          <InlineNotice tone="warning">
            {copy.account.resetNotShown}
          </InlineNotice>
        ))}
    </div>
  )
}
