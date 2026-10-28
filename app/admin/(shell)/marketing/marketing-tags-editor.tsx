"use client"

import { useState } from "react"
import Link from "next/link"

import {
  asSaveResult,
  ValueChangeRow,
  type ValueSaveResult,
} from "@/components/admin/value-change-row"
import { InlineNotice } from "@/components/shared/inline-notice"
import { sectionTitleClass } from "@/components/shared/section-title"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { adminCopy } from "@/lib/copy/admin"
import {
  normalizeTagId,
  TAG_COLUMNS,
  TAG_FIELDS,
  tagProblem,
  type MarketingTagsRow,
  type TagField,
} from "@/lib/marketing-tags"

import { updateMarketingTagsAction } from "./actions"

const copy = adminCopy.marketingTags

export const PRIVACY_EDIT_HREF = "/admin/content/privacy"

export type MarketingTagsEditorRow = MarketingTagsRow & { version: number }

type Draft = Record<TagField, string>

function savedOf(row: MarketingTagsEditorRow, field: TagField): string | null {
  return row[TAG_COLUMNS[field]]
}

function draftFromRow(row: MarketingTagsEditorRow): Draft {
  return {
    ga4: savedOf(row, "ga4") ?? "",
    gtm: savedOf(row, "gtm") ?? "",
    pixel: savedOf(row, "pixel") ?? "",
  }
}

// A row's change as text ("כבוי" for off), or null while the typed value is
// unchanged or not valid (the field shows why).
export function tagChange(
  field: TagField,
  row: MarketingTagsEditorRow,
  typed: string
): { from: string; to: string } | null {
  if (tagProblem(field, typed)) return null
  const next = normalizeTagId(typed)
  const saved = savedOf(row, field)
  if (next === saved) return null
  return { from: saved ?? copy.off, to: next ?? copy.off }
}

// What a row's save sends: the typed value for its field, the saved values
// for the other two and the version this page read; null (nothing is sent)
// while the typed value is unchanged or not valid.
export function savePayload(
  row: MarketingTagsEditorRow,
  field: TagField,
  typed: string,
  idempotencyKey: string
): Parameters<typeof updateMarketingTagsAction>[0] | null {
  if (!tagChange(field, row, typed)) return null
  return {
    ids: { ...draftFromRow(row), [field]: typed },
    expectedVersion: row.version,
    idempotencyKey,
  }
}

// The marketing screen (story 5.24): one value-change-row per tool ID, each
// saved alone with the version this page read; it sends the other two IDs
// as saved. A blank ID turns its tool off ("כבוי"). The format is checked
// as Tal types, under the field.
export function MarketingTagsEditor({ row }: { row: MarketingTagsEditorRow }) {
  const [draft, setDraft] = useState<Draft>(() => draftFromRow(row))

  const save =
    (field: TagField) =>
    async (key: string): Promise<ValueSaveResult | null> => {
      const payload = savePayload(row, field, draft[field], key)
      if (!payload) return null
      return asSaveResult(await updateMarketingTagsAction(payload))
    }

  return (
    <section aria-labelledby="marketing-tags" className="flex flex-col gap-1">
      <h2 id="marketing-tags" className={sectionTitleClass}>
        {copy.section}
      </h2>
      <ul className="flex flex-col divide-y divide-border border-b border-border">
        {TAG_FIELDS.map((field) => {
          const change = tagChange(field, row, draft[field])
          return (
            <li key={field} className="py-6">
              <ValueChangeRow
                label={copy.changeNames[field]}
                oldValue={change?.from ?? ""}
                newValue={change?.to ?? null}
                onSave={save(field)}
                onCancel={() =>
                  setDraft((current) => ({
                    ...current,
                    [field]: draftFromRow(row)[field],
                  }))
                }
              >
                <TagIdField
                  field={field}
                  value={draft[field]}
                  off={savedOf(row, field) === null}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, [field]: value }))
                  }
                />
              </ValueChangeRow>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// One ID: the label (with "כבוי" while nothing is saved), an LTR field, the
// hint and, when the typed value cannot be saved, the format error.
function TagIdField({
  field,
  value,
  off,
  onChange,
}: {
  field: TagField
  value: string
  off: boolean
  onChange: (value: string) => void
}) {
  const id = `marketing-${field}`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const problem = tagProblem(field, value) !== null
  return (
    <Field data-invalid={problem ? true : undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id}>{copy.labels[field]}</FieldLabel>
        {off && (
          <span className="shrink-0 text-[13px] text-muted-foreground">
            {copy.off}
          </span>
        )}
      </div>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        dir="ltr"
        inputMode={field === "pixel" ? "numeric" : "text"}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={64}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${hintId} ${errorId}` : hintId}
        className="h-12 text-start text-base"
      />
      <p id={hintId} className="text-[13px] text-muted-foreground">
        {copy.hints[field]}
      </p>
      {problem && (
        <p id={errorId} className="text-[15px] text-error">
          {copy.errors[field]}
        </p>
      )}
    </Field>
  )
}

// What the screen is for.
export function MarketingIntro() {
  return <p className="text-base leading-normal text-pretty">{copy.intro}</p>
}

// The privacy notice, below the fields, with its link to the privacy
// policy's editor.
export function MarketingPrivacyNotice() {
  return (
    <InlineNotice
      tone="warning"
      actions={
        <Link
          href={PRIVACY_EDIT_HREF}
          className="inline-flex min-h-11 items-center px-1 text-base text-foreground underline underline-offset-[3px]"
        >
          {copy.privacyLink}
        </Link>
      }
    >
      {copy.privacyNotice}
    </InlineNotice>
  )
}
