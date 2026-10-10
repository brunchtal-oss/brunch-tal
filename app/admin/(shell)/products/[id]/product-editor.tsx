"use client"

import { useRef, useState } from "react"

import { SensitiveConfirmDialog } from "@/components/admin/sensitive-confirm-dialog"
import {
  asSaveResult,
  ValueChangeRow,
  type ValueSaveResult,
} from "@/components/admin/value-change-row"
import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { formatAgorot } from "@/lib/money"

import {
  previewProductPriceAction,
  setProductPriceAction,
  updateProductAction,
  type PricePlan,
} from "../actions"
import {
  draftFromRow,
  fieldChange,
  fieldError,
  priceChange,
  type EditorField,
  type ProductDraft,
  type ProductRow,
} from "../product-draft"
import {
  EventKindField,
  IntroOnlyField,
  PartySizeField,
  TextField,
  TypeField,
  ValidityField,
  WeekdaysField,
  WeekdaysToggle,
} from "../product-fields"

const copy = adminCopy.products

// The draft values behind each editor row (for its "cancel").
const DRAFT_KEYS: Record<EditorField, readonly (keyof ProductDraft)[]> = {
  type: ["type"],
  name: ["name"],
  units: ["unitsText"],
  validity: ["validityMode", "validityDaysText"],
  weekdays: ["weekdays"],
  eventKind: ["eventKind"],
  partySize: ["partySize"],
  introOnly: ["introOnly"],
  postJoinMessage: ["postJoinMessage"],
  postJoinButtonLabel: ["postJoinButtonLabel"],
}

// The editor of one product (story 2.6): each field in its own
// value-change-row ("old ← new", saved alone, logged), validity as mode and
// days together, the price through the price_change sensitive dialog, and
// hide / show as a change of its state. The fixed note on top: changes
// apply to new purchases only. The saved values come from the server after
// each save (router.refresh in the row); a failure leaves them as they were.
export function ProductEditor({ row }: { row: ProductRow }) {
  const [draft, setDraft] = useState<ProductDraft>(() => draftFromRow(row))
  const [active, setActive] = useState(row.active)
  // A product valid on every day hides the weekday row behind a link; a
  // restricted one shows it, so Tal sees the restriction and can lift it.
  const [weekdaysFocus, setWeekdaysFocus] = useState(false)
  const [weekdaysOpen, setWeekdaysOpen] = useState(
    row.allowed_weekdays !== null
  )
  const update = (patch: Partial<ProductDraft>) =>
    setDraft((current) => ({ ...current, ...patch }))
  // "Cancel" of a row: its draft values go back to the saved ones.
  const revert = (keys: readonly (keyof ProductDraft)[]) => {
    const saved = draftFromRow(row)
    update(Object.fromEntries(keys.map((key) => [key, saved[key]])))
  }

  // The price dialog: opened by the price row's save, which waits for it.
  const [pricePlan, setPricePlan] = useState<{
    plan: PricePlan
    key: string
  } | null>(null)
  const [reason, setReason] = useState("")
  const [pricePending, setPricePending] = useState(false)
  const priceAnswer = useRef<((result: ValueSaveResult | null) => void) | null>(
    null
  )

  const closePriceDialog = (result: ValueSaveResult | null) => {
    setPricePlan(null)
    priceAnswer.current?.(result)
    priceAnswer.current = null
  }

  const saveField = (field: EditorField) => async (key: string) => {
    const change = fieldChange(field, row, draft)
    if (!change) return null
    return asSaveResult(
      await updateProductAction({
        productId: row.id,
        changes: change.changes,
        idempotencyKey: key,
      })
    )
  }

  const savePrice = async (key: string): Promise<ValueSaveResult | null> => {
    const change = priceChange(row, draft)
    if (!change) return null
    const preview = await previewProductPriceAction({
      productId: row.id,
      priceAgorot: change.priceAgorot,
    })
    if (!preview.ok) return { ok: false, code: preview.code }
    return new Promise((resolve) => {
      priceAnswer.current = resolve
      setReason("")
      setPricePlan({ plan: preview.data, key })
    })
  }

  const confirmPrice = async () => {
    if (!pricePlan || pricePending) return
    setPricePending(true)
    let result: ValueSaveResult
    try {
      result = asSaveResult(
        await setProductPriceAction({
          productId: row.id,
          priceAgorot: pricePlan.plan.newPriceAgorot,
          reason,
          confirmed: true,
          idempotencyKey: pricePlan.key,
        })
      )
    } catch {
      // A thrown action (network): the row shows the error, nothing changed.
      result = { ok: false, code: "SERVER_ERROR" }
    } finally {
      setPricePending(false)
    }
    closePriceDialog(result)
  }

  const fieldRow = (
    field: EditorField,
    label: string,
    children: React.ReactNode
  ) => {
    const change = fieldChange(field, row, draft)
    return (
      <ValueChangeRow
        label={label}
        oldValue={change?.from ?? ""}
        newValue={change?.to ?? null}
        onSave={saveField(field)}
        onCancel={() => revert(DRAFT_KEYS[field])}
      >
        {children}
      </ValueChangeRow>
    )
  }

  const price = priceChange(row, draft)
  const priceProblem = fieldError("price", draft)
  const hideChange = active !== row.active

  return (
    <div className="flex flex-col gap-6">
      <InlineNotice tone="info">{copy.scopeNote}</InlineNotice>

      <ul className="flex flex-col divide-y divide-border border-y border-border">
        <li className="py-6">
          {fieldRow(
            "type",
            copy.fields.type,
            <TypeField
              name="type"
              value={draft.type}
              onChange={(type) => update({ type })}
            />
          )}
        </li>
        <li className="py-6">
          {fieldRow(
            "name",
            copy.fields.name,
            <TextField
              id="name"
              label={copy.fields.name}
              value={draft.name}
              onChange={(name) => update({ name })}
              problem={fieldError("name", draft)}
              required
              maxLength={200}
            />
          )}
        </li>
        <li className="py-6">
          <ValueChangeRow
            label={copy.fields.price}
            oldValue={price?.from ?? ""}
            newValue={price?.to ?? null}
            onSave={savePrice}
            onCancel={() => revert(["priceText"])}
          >
            <TextField
              id="price"
              label={copy.fields.price}
              value={draft.priceText}
              onChange={(priceText) => update({ priceText })}
              problem={priceProblem}
              invalidText={adminCopy.payments.amountInvalid}
              required
              decimal
              maxLength={12}
            />
          </ValueChangeRow>
        </li>
        <li className="py-6">
          {fieldRow(
            "units",
            copy.fields.units,
            <TextField
              id="units"
              label={copy.fields.units}
              value={draft.unitsText}
              onChange={(unitsText) => update({ unitsText })}
              problem={fieldError("units", draft)}
              required
              numeric
              maxLength={4}
            />
          )}
        </li>
        <li className="py-6">
          {fieldRow(
            "validity",
            copy.fields.validity,
            <ValidityField
              name="validity"
              mode={draft.validityMode}
              daysText={draft.validityDaysText}
              onModeChange={(validityMode) => update({ validityMode })}
              onDaysChange={(validityDaysText) => update({ validityDaysText })}
              daysProblem={fieldError("validityDays", draft)}
            />
          )}
        </li>
        <li className="py-6">
          {weekdaysOpen ? (
            fieldRow(
              "weekdays",
              copy.fields.weekdays,
              <WeekdaysField
                name="weekdays"
                value={draft.weekdays}
                onChange={(weekdays) => update({ weekdays })}
                autoFocus={weekdaysFocus}
              />
            )
          ) : (
            <WeekdaysToggle
              onOpen={() => {
                setWeekdaysFocus(true)
                setWeekdaysOpen(true)
              }}
            />
          )}
        </li>
        <li className="py-6">
          {fieldRow(
            "eventKind",
            copy.fields.eventKind,
            <EventKindField
              name="eventKind"
              value={draft.eventKind}
              onChange={(eventKind) => update({ eventKind })}
            />
          )}
        </li>
        <li className="py-6">
          {fieldRow(
            "partySize",
            copy.fields.partySize,
            <PartySizeField
              name="partySize"
              value={draft.partySize}
              onChange={(partySize) => update({ partySize })}
            />
          )}
        </li>
        <li className="py-6">
          {fieldRow(
            "introOnly",
            copy.fields.introOnly,
            <IntroOnlyField
              id="introOnly"
              value={draft.introOnly}
              onChange={(introOnly) => update({ introOnly })}
            />
          )}
        </li>
        <li className="py-6">
          {fieldRow(
            "postJoinMessage",
            copy.fields.postJoinMessage,
            <TextField
              id="postJoinMessage"
              label={copy.fields.postJoinMessage}
              value={draft.postJoinMessage}
              onChange={(postJoinMessage) => update({ postJoinMessage })}
              maxLength={1000}
              multiline
            />
          )}
        </li>
        <li className="py-6">
          {fieldRow(
            "postJoinButtonLabel",
            copy.fields.postJoinButtonLabel,
            <TextField
              id="postJoinButtonLabel"
              label={copy.fields.postJoinButtonLabel}
              value={draft.postJoinButtonLabel}
              onChange={(postJoinButtonLabel) =>
                update({ postJoinButtonLabel })
              }
              maxLength={100}
            />
          )}
        </li>
        <li className="py-6">
          <ValueChangeRow
            label={copy.state}
            oldValue={row.active ? copy.stateOffered : copy.stateHidden}
            newValue={
              hideChange
                ? active
                  ? copy.stateOffered
                  : copy.stateHidden
                : null
            }
            scope={copy.hideScope}
            onCancel={() => setActive(row.active)}
            onSave={async (key) =>
              asSaveResult(
                await updateProductAction({
                  productId: row.id,
                  changes: { active },
                  idempotencyKey: key,
                })
              )
            }
          >
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 self-start px-4 text-base"
              onClick={() => setActive((current) => !current)}
            >
              {active ? copy.hide : copy.show}
            </Button>
          </ValueChangeRow>
        </li>
      </ul>

      {pricePlan && (
        <SensitiveConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) closePriceDialog(null)
          }}
          action="price_change"
          description={copy.scopeNote}
          impact={[
            {
              label: copy.priceDialog.product,
              value: <bdi>{pricePlan.plan.name}</bdi>,
            },
            {
              label: copy.priceDialog.price,
              value: (
                <bdi className="font-semibold">
                  {copy.priceDialog.priceChange(
                    formatAgorot(pricePlan.plan.oldPriceAgorot),
                    formatAgorot(pricePlan.plan.newPriceAgorot)
                  )}
                </bdi>
              ),
            },
          ]}
          reason={{
            label: copy.priceDialog.reason,
            value: reason,
            onChange: setReason,
          }}
          checkboxLabel={copy.priceDialog.confirm(
            pricePlan.plan.name,
            formatAgorot(pricePlan.plan.newPriceAgorot)
          )}
          confirmLabel={adminCopy.valueChange.save}
          pending={pricePending}
          onConfirm={confirmPrice}
        />
      )}
    </div>
  )
}
