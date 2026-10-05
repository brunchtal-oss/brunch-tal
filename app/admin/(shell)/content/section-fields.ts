import { BODY_REQUIRED_SECTIONS } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"

import type { ContentObject, SectionRef } from "./content-items"

// The editor's description of each kind (story 5.3): the fields it edits,
// in order. A text field, or a list of items with its own text fields (add,
// move, hide, delete). 5.4 adds an image field as a new field type, without
// rewriting the editor. Pure, so the client editor builds it from the
// section's slug, key and kind.

const copy = adminCopy.content

export type TextField = {
  type: "text"
  name: string
  label: string
  hint?: string
  multiline?: boolean
  maxLength?: number
  inputType?: "text" | "tel" | "url"
  // Numbers and links read left to right inside the RTL form.
  ltr?: boolean
}

export type ListField = {
  type: "list"
  name: "items"
  // The name of an item without a first field ("המלצה 2").
  itemLabel: (n: number) => string
  addLabel: string
  fields: readonly TextField[]
}

export type EditorFieldSpec = TextField | ListField

export type SectionSpec = {
  fields: readonly EditorFieldSpec[]
  // A "hide the section" button (a hidden flag in the draft).
  hideable: boolean
}

const text = (
  name: string,
  label: string,
  more: Omit<TextField, "type" | "name" | "label"> = {}
): TextField => ({ type: "text", name, label, ...more })

const listTitle = text("title", copy.listTitle, { maxLength: 120 })

const business = copy.business

// The business details' fields (lib/content/schema.ts ›
// businessDetailsSchema). The payment instructions stay in the schema and
// the database but are not edited (user decision 2026-10-05).
const BUSINESS_FIELDS: readonly TextField[] = [
  text("whatsapp_phone", business.whatsappPhone, {
    hint: business.whatsappPhoneHint,
    inputType: "tel",
    maxLength: 30,
    ltr: true,
  }),
  text("business_name", business.businessName, { maxLength: 80 }),
  text("phone", business.phone, { inputType: "tel", maxLength: 30, ltr: true }),
  text("whatsapp_message", business.whatsappMessage, {
    hint: business.whatsappMessageHint,
    multiline: true,
    maxLength: 500,
  }),
  text("address", business.address, { maxLength: 200 }),
  text("arrival_instructions", business.arrivalInstructions, {
    multiline: true,
    maxLength: 1000,
  }),
  text("navigation_url", business.navigationUrl, {
    hint: business.navigationUrlHint,
    inputType: "url",
    maxLength: 500,
    ltr: true,
  }),
]

export function sectionSpec(ref: SectionRef): SectionSpec {
  switch (ref.kind) {
    case "hero":
      return {
        hideable: false,
        fields: [
          text("title", copy.hero.title, { maxLength: 80 }),
          text("description", copy.hero.description, {
            multiline: true,
            maxLength: 300,
          }),
        ],
      }
    case "text_block": {
      const bodyRequired = BODY_REQUIRED_SECTIONS.includes(
        `${ref.slug}/${ref.key}`
      )
      return {
        hideable: true,
        fields: [
          text("eyebrow", copy.textBlock.eyebrow, { maxLength: 60 }),
          text("title", copy.textBlock.title, { maxLength: 120 }),
          text(
            "body",
            bodyRequired ? copy.textBlock.body : copy.textBlock.bodyOptional,
            { multiline: true, maxLength: 5000 }
          ),
        ],
      }
    }
    case "steps":
      return {
        hideable: true,
        fields: [
          listTitle,
          {
            type: "list",
            name: "items",
            itemLabel: copy.steps.item,
            addLabel: copy.steps.add,
            fields: [
              text("title", copy.steps.title, { maxLength: 120 }),
              text("body", copy.steps.body, {
                multiline: true,
                maxLength: 1000,
              }),
            ],
          },
        ],
      }
    case "faq":
      return {
        hideable: true,
        fields: [
          listTitle,
          {
            type: "list",
            name: "items",
            itemLabel: copy.faq.item,
            addLabel: copy.faq.add,
            fields: [
              text("question", copy.faq.question, { maxLength: 300 }),
              text("answer", copy.faq.answer, {
                multiline: true,
                maxLength: 3000,
              }),
            ],
          },
        ],
      }
    case "testimonials":
      return {
        hideable: true,
        fields: [
          listTitle,
          {
            type: "list",
            name: "items",
            itemLabel: copy.testimonials.item,
            addLabel: copy.testimonials.add,
            fields: [
              text("name", copy.testimonials.name, { maxLength: 80 }),
              text("text", copy.testimonials.text, {
                multiline: true,
                maxLength: 1500,
              }),
            ],
          },
        ],
      }
    case "footer":
      return {
        hideable: false,
        fields: [
          {
            type: "list",
            name: "items",
            itemLabel: copy.footerLinks.item,
            addLabel: copy.footerLinks.add,
            fields: [
              text("label", copy.footerLinks.label, {
                hint: copy.footerLinks.labelHint,
                maxLength: 60,
              }),
              text("url", copy.footerLinks.url, {
                hint: copy.footerLinks.urlHint,
                inputType: "url",
                maxLength: 500,
                ltr: true,
              }),
            ],
          },
        ],
      }
    case "photo_consent":
      return {
        hideable: false,
        fields: [
          text("question", copy.photoConsent.question, {
            hint: copy.photoConsent.questionHint,
            multiline: true,
            maxLength: 1000,
          }),
          text("yes_label", copy.photoConsent.yes, { maxLength: 200 }),
          text("no_label", copy.photoConsent.no, { maxLength: 200 }),
        ],
      }
    case "business_details":
      return { hideable: false, fields: BUSINESS_FIELDS }
    default:
      return { hideable: false, fields: [] }
  }
}

// The form's state: text values by name, and each list's items. An item has
// a client-only id (React key, focus targets) and its hidden flag.
export type EditorItem = {
  id: string
  hidden: boolean
  values: Record<string, string>
}

export type EditorState = {
  text: Record<string, string>
  items: EditorItem[]
  hidden: boolean
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

function listOf(spec: SectionSpec): ListField | null {
  return (
    (spec.fields.find((field) => field.type === "list") as ListField) ?? null
  )
}

// The form's state from saved content (the draft, else what is published).
// Fields the editor does not edit are left out, so saving drops them
// (hero › cta_label, footer › text); the payment instructions are carried
// over instead (keptFields).
export function fromContent(
  spec: SectionSpec,
  content: ContentObject
): EditorState {
  const list = listOf(spec)
  const rawItems = list && Array.isArray(content.items) ? content.items : []
  return {
    text: Object.fromEntries(
      spec.fields
        .filter((field): field is TextField => field.type === "text")
        .map((field) => [field.name, str(content[field.name])])
    ),
    items: rawItems.map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>
      return {
        id: `i${index}`,
        hidden: item.hidden === true,
        values: Object.fromEntries(
          (list?.fields ?? []).map((field) => [
            field.name,
            str(item[field.name]),
          ])
        ),
      }
    }),
    hidden: spec.hideable && content.hidden === true,
  }
}

// The content the form saves: text fields as typed (the schema trims and
// drops empty optional ones), the items in order with hidden: true only
// when hidden, and hidden: true for a hidden section. keep: fields of the
// saved content the editor does not show but must not lose.
export function toContent(
  spec: SectionSpec,
  state: EditorState,
  keep: ContentObject = {}
): ContentObject {
  const content: ContentObject = { ...keep }
  for (const field of spec.fields) {
    if (field.type === "text")
      content[field.name] = state.text[field.name] ?? ""
    else {
      content.items = state.items.map((item) => ({
        ...Object.fromEntries(
          field.fields.map((sub) => [sub.name, item.values[sub.name] ?? ""])
        ),
        ...(item.hidden ? { hidden: true } : {}),
      }))
    }
  }
  if (spec.hideable && state.hidden) content.hidden = true
  return content
}

// The fields of the saved content that the editor carries over unchanged:
// the business details' payment instructions (out of the editor, kept in
// the database; user decision 2026-10-05).
export function keptFields(
  ref: SectionRef,
  content: ContentObject
): ContentObject {
  if (
    ref.kind === "business_details" &&
    typeof content.payment_instructions === "string"
  ) {
    return { payment_instructions: content.payment_instructions }
  }
  return {}
}

// The name of an item: its first field, else "{type} {n}" (1-based).
export function itemName(
  list: ListField,
  item: EditorItem,
  index: number
): string {
  const first = item.values[list.fields[0]?.name ?? ""]?.trim() ?? ""
  if (!first) return list.itemLabel(index + 1)
  return first.length > 40 ? `${first.slice(0, 40)}…` : first
}

// The list operations (pure; the editor keeps everything in the draft until
// publishing).
export function addItem(
  items: readonly EditorItem[],
  list: ListField,
  id: string
): EditorItem[] {
  return [
    ...items,
    {
      id,
      hidden: false,
      values: Object.fromEntries(list.fields.map((field) => [field.name, ""])),
    },
  ]
}

export function moveItem(
  items: readonly EditorItem[],
  index: number,
  delta: -1 | 1
): EditorItem[] {
  const target = index + delta
  if (index < 0 || index >= items.length) return [...items]
  if (target < 0 || target >= items.length) return [...items]
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function toggleItemHidden(
  items: readonly EditorItem[],
  index: number
): EditorItem[] {
  return items.map((item, i) =>
    i === index ? { ...item, hidden: !item.hidden } : item
  )
}

export function removeItem(
  items: readonly EditorItem[],
  index: number
): EditorItem[] {
  return items.filter((_, i) => i !== index)
}

// The id of a field's input: "field-title", "field-items-2-text".
export function fieldId(path: string): string {
  return `field-${path.replace(/\./g, "-")}`
}
