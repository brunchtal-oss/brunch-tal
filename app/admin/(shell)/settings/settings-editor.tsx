"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import {
  ValueChangeRow,
  type ValueSaveResult,
} from "@/components/admin/value-change-row"
import { adminCopy } from "@/lib/copy/admin"

import { updateSettingsAction } from "./actions"
import {
  draftFromRow,
  draftProblem,
  problemText,
  settingChange,
  type EditorField,
  type NumberField,
  type SettingsDraft,
  type SettingsRow,
} from "./settings-draft"
import {
  NumberField as NumberInput,
  PrepDaysField,
  TimeField,
} from "./settings-fields"

const copy = adminCopy.settings

export const BUSINESS_DETAILS_HREF = "/admin/content/contact"
export const TERMS_HREF = "/admin/content/terms"
export const TEMPLATES_HREF = "/admin/settings/templates"

// The draft values behind each row (for its "cancel").
function draftKeys(field: EditorField): readonly (keyof SettingsDraft)[] {
  if (field === "close") return ["closeDays", "closeTime"]
  if (field === "sessionHours") return ["sessionStart", "sessionEnd"]
  return [field]
}

// The scope note of each row (EXPERIENCE › admin states › settings).
export function scopeOf(field: EditorField): React.ReactNode {
  if (field === "cancelWindow") {
    return (
      <>
        {copy.scope.bookings}. {copy.cancelPolicy}.{" "}
        <Link
          href={TERMS_HREF}
          className="text-foreground underline underline-offset-[3px]"
        >
          {copy.termsLink}
        </Link>
      </>
    )
  }
  if (field === "reminder") return copy.scope.bookings
  if (field === "creditOptions") return copy.scope.credits
  return copy.scope.new
}

// The settings screen (story 4.7): the defaults in groups, each value in
// its own value-change-row ("old ← new", no checkbox, user decision
// 2026-10-06), saved alone with the version this page read; the business
// details and the templates are links. The saved values come from the
// server after each save (router.refresh in the row); a failure leaves them
// as they were and shows its message in the row.
export function SettingsEditor({ row }: { row: SettingsRow }) {
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromRow(row))
  const update = (patch: Partial<SettingsDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))
  const revert = (keys: readonly (keyof SettingsDraft)[]) => {
    const saved = draftFromRow(row)
    update(Object.fromEntries(keys.map((key) => [key, saved[key]])))
  }
  const problem = (key: keyof SettingsDraft) => {
    const found = draftProblem(key, draft)
    return found ? problemText(found) : null
  }

  const save =
    (field: EditorField) =>
    async (key: string): Promise<ValueSaveResult | null> => {
      const change = settingChange(field, row, draft)
      if (!change) return null
      const result = await updateSettingsAction({
        changes: change.changes,
        expectedVersion: row.version,
        idempotencyKey: key,
      })
      return result.ok ? { ok: true } : { ok: false, code: result.code }
    }

  const settingRow = (field: EditorField, children: React.ReactNode) => {
    const change = settingChange(field, row, draft)
    return (
      <li className="py-5">
        <ValueChangeRow
          label={copy.labels[field]}
          oldValue={change?.from ?? ""}
          newValue={change?.to ?? null}
          scope={scopeOf(field)}
          onSave={save(field)}
          onCancel={() => revert(draftKeys(field))}
        >
          {children}
        </ValueChangeRow>
      </li>
    )
  }

  const numberRow = (field: NumberField) =>
    settingRow(
      field,
      <NumberInput
        id={`setting-${field}`}
        label={copy.fields[field]}
        value={draft[field]}
        onChange={(value) => update({ [field]: value })}
        problem={problem(field)}
      />
    )

  return (
    <div className="flex flex-col gap-10">
      <LinkGroup
        id="settings-business"
        title={copy.groups.business}
        href={BUSINESS_DETAILS_HREF}
        label={copy.businessLink}
        note={copy.businessNote}
      />

      <Group id="settings-registration" title={copy.groups.registration}>
        {settingRow(
          "close",
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">
              {copy.fields.close}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                id="setting-close-days"
                label={copy.fields.closeDays}
                value={draft.closeDays}
                onChange={(closeDays) => update({ closeDays })}
                problem={problem("closeDays")}
              />
              <TimeField
                id="setting-close-time"
                label={copy.fields.closeTime}
                value={draft.closeTime}
                onChange={(closeTime) => update({ closeTime })}
                problem={problem("closeTime")}
              />
            </div>
          </fieldset>
        )}
        {numberRow("cancelWindow")}
      </Group>

      <Group id="settings-session" title={copy.groups.newSession}>
        {settingRow(
          "sessionHours",
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">
              {copy.fields.sessionHours}
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <TimeField
                id="setting-session-start"
                label={copy.fields.sessionStart}
                value={draft.sessionStart}
                onChange={(sessionStart) => update({ sessionStart })}
                problem={problem("sessionStart")}
              />
              <TimeField
                id="setting-session-end"
                label={copy.fields.sessionEnd}
                value={draft.sessionEnd}
                onChange={(sessionEnd) => update({ sessionEnd })}
                problem={problem("sessionEnd")}
              />
            </div>
          </fieldset>
        )}
        {numberRow("capacityRegular")}
        {numberRow("capacityCouple")}
      </Group>

      <Group id="settings-product" title={copy.groups.newProduct}>
        {numberRow("validity")}
      </Group>

      <Group id="settings-credit" title={copy.groups.creditReminder}>
        {numberRow("creditOptions")}
        {numberRow("reminder")}
      </Group>

      <Group id="settings-alerts" title={copy.groups.alerts}>
        {numberRow("adminExpiring")}
        {numberRow("customerExpiring")}
        {numberRow("lastPlaces")}
        {numberRow("inactivity")}
        {numberRow("duplicateWindow")}
      </Group>

      <Group id="settings-work" title={copy.groups.workSheet}>
        {settingRow(
          "prepDays",
          <PrepDaysField
            value={draft.prepDays}
            onChange={(prepDays) => update({ prepDays })}
          />
        )}
      </Group>

      <LinkGroup
        id="settings-templates"
        title={copy.groups.templates}
        href={TEMPLATES_HREF}
        label={copy.templatesLink}
        note={copy.templatesNote}
      />
    </div>
  )
}

// A group of settings: an h2 in display-sm and its rows between dividers.
function Group({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2
        id={id}
        className="font-heading text-[22px] leading-[1.25] font-light text-balance"
      >
        {title}
      </h2>
      <ul className="flex flex-col divide-y divide-border border-b border-border">
        {children}
      </ul>
    </section>
  )
}

// A group that leads to another screen: one row with a chevron, like the
// rows of "more".
function LinkGroup({
  id,
  title,
  href,
  label,
  note,
}: {
  id: string
  title: string
  href: string
  label: string
  note: string
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2
        id={id}
        className="font-heading text-[22px] leading-[1.25] font-light text-balance"
      >
        {title}
      </h2>
      <Link
        href={href}
        className="flex min-h-12 items-center justify-between gap-3 border-b border-border py-3"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-base font-semibold">{label}</span>
          <span className="text-[13px] text-muted-foreground">{note}</span>
        </span>
        <ChevronLeftIcon
          aria-hidden
          strokeWidth={1.5}
          className="size-5 shrink-0 text-muted-foreground"
        />
      </Link>
    </section>
  )
}
