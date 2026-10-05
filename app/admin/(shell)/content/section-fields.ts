import { BODY_REQUIRED_SECTIONS } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"

import type { ContentObject, SectionRef } from "./content-items"

// The editor's description of each kind (story 5.3): the fields it edits,
// in order. A text field, or a list of items with its own fields (add, move,
// hide, delete). Story 5.4 adds an image field (image-upload-field), a
// choice field (a testimonial is text or an image) and showWhen (an item
// field shown only for one choice), without rewriting the editor. Pure, so
// the client editor builds it from the section's slug, key and kind.

const copy = adminCopy.content

// An item field shown only while the item's choice field has this value.
export type ShowWhen = { field: string; value: string }

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
  showWhen?: ShowWhen
}

// An aspect the image is shown in on the site (width / height); the editor
// frames the first one around the focus point. None: the image is shown
// whole (a screenshot), so there is no focus point to set.
export type ImageAspect = { ratio: number }

// An image (story 5.4): {media_id, alt?, focus_x, focus_y} in the content.
export type ImageField = {
  type: "image"
  name: string
  label: string
  hint?: string
  altHint?: string
  aspects: readonly ImageAspect[]
  showWhen?: ShowWhen
}

// One of a few values (radio-card), e.g. a testimonial's kind.
export type ChoiceField = {
  type: "choice"
  name: string
  label: string
  options: readonly { value: string; label: string }[]
  defaultValue: string
}

export type ItemFieldSpec = TextField | ImageField | ChoiceField

export type ListField = {
  type: "list"
  name: "items"
  // The name of an item without a text field ("המלצה 2").
  itemLabel: (n: number) => string
  addLabel: string
  // A second add button above a long list (user decision 2026-10-06: the
  // gallery and the testimonials). The new item is still added last.
  addAtTop?: boolean
  fields: readonly ItemFieldSpec[]
}

export type EditorFieldSpec = TextField | ImageField | ListField

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

const image = (
  name: string,
  label: string,
  more: Partial<Omit<ImageField, "type" | "name" | "label">> = {}
): ImageField => ({ type: "image", name, label, aspects: [], ...more })

// Where each image is shown (DESIGN): the hero fills the phone's screen
// (min-height 560px at 360px), about and the gallery are 4:5.
const HERO_ASPECTS: readonly ImageAspect[] = [{ ratio: 360 / 560 }]
const PORTRAIT_ASPECTS: readonly ImageAspect[] = [{ ratio: 4 / 5 }]

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

const TEXT_TESTIMONIAL: ShowWhen = { field: "kind", value: "text" }
const IMAGE_TESTIMONIAL: ShowWhen = { field: "kind", value: "image" }

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
          image("image", copy.blockImage, {
            hint: copy.heroImageHint,
            aspects: HERO_ASPECTS,
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
          // Only about › main has an image (story 5.4).
          ...(ref.slug === "about" && ref.key === "main"
            ? [image("image", copy.blockImage, { aspects: PORTRAIT_ASPECTS })]
            : []),
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
            addAtTop: true,
            fields: [
              {
                type: "choice",
                name: "kind",
                label: copy.testimonials.kind,
                options: [
                  { value: "text", label: copy.testimonials.kinds.text },
                  { value: "image", label: copy.testimonials.kinds.image },
                ],
                defaultValue: "text",
              },
              text("name", copy.testimonials.name, {
                maxLength: 80,
                showWhen: TEXT_TESTIMONIAL,
              }),
              text("text", copy.testimonials.text, {
                multiline: true,
                maxLength: 1500,
                showWhen: TEXT_TESTIMONIAL,
              }),
              image("image", copy.testimonials.image, {
                hint: copy.testimonials.imageHint,
                altHint: copy.testimonials.altHint,
                showWhen: IMAGE_TESTIMONIAL,
              }),
              text("name", copy.testimonials.imageName, {
                maxLength: 80,
                showWhen: IMAGE_TESTIMONIAL,
              }),
            ],
          },
        ],
      }
    case "gallery":
      return {
        hideable: true,
        fields: [
          listTitle,
          {
            type: "list",
            name: "items",
            itemLabel: copy.gallery.item,
            addLabel: copy.gallery.add,
            addAtTop: true,
            fields: [
              image("image", copy.gallery.image, {
                aspects: PORTRAIT_ASPECTS,
              }),
              text("caption", copy.gallery.caption, { maxLength: 200 }),
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

// An image in the form (story 5.4); alt is "" when not filled.
export type ImageValue = {
  media_id: string
  alt: string
  focus_x: number
  focus_y: number
}

// The form's state: text values by name, images by name, and each list's
// items. An item has a client-only id (React key, focus targets), its hidden
// flag, its text and choice values, and its images (when the list has
// image fields).
export type EditorItem = {
  id: string
  hidden: boolean
  values: Record<string, string>
  images?: Record<string, ImageValue | null>
}

export type EditorState = {
  text: Record<string, string>
  images?: Record<string, ImageValue | null>
  items: EditorItem[]
  hidden: boolean
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function focusOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(100, Math.max(0, value))
    : 50
}

// An image of saved content, or null.
export function imageOf(value: unknown): ImageValue | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (typeof raw.media_id !== "string" || !UUID.test(raw.media_id)) return null
  return {
    media_id: raw.media_id,
    alt: str(raw.alt),
    focus_x: focusOf(raw.focus_x),
    focus_y: focusOf(raw.focus_y),
  }
}

// The content of an image (an empty alt is left out).
export function imageContent(value: ImageValue): ContentObject {
  return {
    media_id: value.media_id,
    ...(value.alt.trim() ? { alt: value.alt } : {}),
    focus_x: value.focus_x,
    focus_y: value.focus_y,
  }
}

// Whether an item field is shown for the item's values.
export function shownFor(
  field: ItemFieldSpec,
  values: Record<string, string>
): boolean {
  const when = field.type === "choice" ? undefined : field.showWhen
  return !when || values[when.field] === when.value
}

function listOf(spec: SectionSpec): ListField | null {
  return (
    (spec.fields.find((field) => field.type === "list") as ListField) ?? null
  )
}

// The value of an item field that is not an image (a choice: the saved
// value, else its default).
function itemValue(field: TextField | ChoiceField, raw: unknown): string {
  if (field.type === "choice") {
    const value = str(raw)
    return field.options.some((option) => option.value === value)
      ? value
      : field.defaultValue
  }
  return str(raw)
}

function imageFields(fields: readonly (EditorFieldSpec | ItemFieldSpec)[]) {
  return fields.filter((field): field is ImageField => field.type === "image")
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
  const images = imageFields(spec.fields)
  const itemImages = imageFields(list?.fields ?? [])
  const state: EditorState = {
    text: Object.fromEntries(
      spec.fields
        .filter((field): field is TextField => field.type === "text")
        .map((field) => [field.name, str(content[field.name])])
    ),
    items: rawItems.map((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>
      const values: Record<string, string> = {}
      for (const field of list?.fields ?? []) {
        if (field.type === "image") continue
        // Two fields may share a name (a testimonial's name): the first wins.
        if (!(field.name in values)) {
          values[field.name] = itemValue(field, item[field.name])
        }
      }
      const editorItem: EditorItem = {
        id: `i${index}`,
        hidden: item.hidden === true,
        values,
      }
      if (itemImages.length > 0) {
        editorItem.images = Object.fromEntries(
          itemImages.map((field) => [field.name, imageOf(item[field.name])])
        )
      }
      return editorItem
    }),
    hidden: spec.hideable && content.hidden === true,
  }
  if (images.length > 0) {
    state.images = Object.fromEntries(
      images.map((field) => [field.name, imageOf(content[field.name])])
    )
  }
  return state
}

// The content the form saves: text fields as typed (the schema trims and
// drops empty optional ones), images that are set, the items in order with
// their shown fields and hidden: true only when hidden, and hidden: true for
// a hidden section. keep: fields of the saved content the editor does not
// show but must not lose.
export function toContent(
  spec: SectionSpec,
  state: EditorState,
  keep: ContentObject = {}
): ContentObject {
  const content: ContentObject = { ...keep }
  for (const field of spec.fields) {
    if (field.type === "text") {
      content[field.name] = state.text[field.name] ?? ""
    } else if (field.type === "image") {
      const value = state.images?.[field.name]
      if (value) content[field.name] = imageContent(value)
    } else {
      content.items = state.items.map((item) => {
        const entry: ContentObject = {}
        for (const sub of field.fields) {
          if (!shownFor(sub, item.values)) continue
          if (sub.type === "image") {
            const value = item.images?.[sub.name]
            if (value) entry[sub.name] = imageContent(value)
          } else {
            entry[sub.name] = item.values[sub.name] ?? ""
          }
        }
        if (item.hidden) entry.hidden = true
        return entry
      })
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

// The name of an item: its first shown text field, else "{type} {n}"
// (1-based).
export function itemName(
  list: ListField,
  item: EditorItem,
  index: number
): string {
  const field = list.fields.find(
    (sub) => sub.type === "text" && shownFor(sub, item.values)
  )
  const first = item.values[field?.name ?? ""]?.trim() ?? ""
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
  const values: Record<string, string> = {}
  for (const field of list.fields) {
    if (field.type === "image" || field.name in values) continue
    values[field.name] = field.type === "choice" ? field.defaultValue : ""
  }
  const images = imageFields(list.fields)
  return [
    ...items,
    {
      id,
      hidden: false,
      values,
      ...(images.length > 0
        ? {
            images: Object.fromEntries(
              images.map((field) => [field.name, null])
            ),
          }
        : {}),
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

// Every image the form holds (to preview them, and to know what publishing
// will publish).
export function stateImages(state: EditorState): ImageValue[] {
  const all: ImageValue[] = []
  for (const value of Object.values(state.images ?? {})) {
    if (value) all.push(value)
  }
  for (const item of state.items) {
    for (const value of Object.values(item.images ?? {})) {
      if (value) all.push(value)
    }
  }
  return all
}
