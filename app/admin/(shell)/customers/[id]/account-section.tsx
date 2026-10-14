"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { LinkShare } from "@/components/admin/link-share"
import {
  asSaveResult,
  ValueChangeRow,
} from "@/components/admin/value-change-row"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
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
import { emailChange, phoneChange, type AccountView } from "./card-items"

const copy = adminCopy.customers.card
const INPUT = "h-12 text-start text-base"

// The account section of the customer card (story 2.8): Tal changes the
// email (two steps on the server, AD-21) and the phone, each in a
// value-change-row ("old ← new", saved alone, logged), and issues a reset
// link that she sends herself (shown once, AD-10). Rows with a divider, as
// in the product editor; nothing is optimistic: after a save the page
// reloads from the server.
export function AccountSection({
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
  const [emailDraft, setEmailDraft] = useState(email)
  const [phoneDraft, setPhoneDraft] = useState(phone)
  // Stuck after Auth took the address: the saved email is already the new
  // one, and saving it again finishes the change.
  const nextEmail = emailChange(email, emailDraft, view.stuck)
  const nextPhone = phoneChange(phone, phoneDraft)

  return (
    <div className="flex flex-col gap-4">
      {view.stuck && (
        <InlineNotice tone="warning">
          {copy.account.emailChangeStuck}
        </InlineNotice>
      )}
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {view.canChangeEmail && (
          <li className="py-5">
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
              onCancel={() => setEmailDraft(email)}
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
          </li>
        )}
        <li className="py-5">
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
            onCancel={() => setPhoneDraft(phone)}
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
        </li>
        {view.canIssueReset && (
          <li className="py-5">
            <ResetLink customerId={customerId} view={view} />
          </li>
        )}
      </ul>
    </div>
  )
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

// The latest reset link's status, the button, and after issuing the
// validity with "send on WhatsApp" and "copy the link".
function ResetLink({
  customerId,
  view,
}: {
  customerId: string
  view: AccountView
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
      view={view}
      pending={pending}
      issued={issued}
      error={error}
      onIssue={issue}
    />
  )
}

export function ResetLinkView({
  view,
  pending,
  issued,
  error,
  onIssue,
}: {
  view: AccountView
  pending: boolean
  issued: Issued | null
  error: ErrorCode | null
  onIssue: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {view.resetStatus && (
        <p className="text-base">
          <time dateTime={view.resetStatus.at}>
            <bdi>{view.resetStatus.text}</bdi>
          </time>
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 self-start border-foreground bg-transparent px-4 text-base"
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        onClick={onIssue}
      >
        {pending && <Spinner aria-hidden />}
        {view.resetButton}
      </Button>
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
