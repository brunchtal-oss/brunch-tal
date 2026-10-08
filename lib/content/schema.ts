import { z } from "zod"

import { whatsappHref } from "./whatsapp"

// One schema per content_sections.kind (AD-16). The editor checks against it
// before saving and before publishing (the Server Action), and the site
// parses with it; a block that does not match is not shown.

// An optional text field: spaces around it are dropped and an empty value is
// the same as a missing one, so the editor can send its empty inputs as "".
function optionalText(max: number) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(max).optional()
  )
}

// A phone that a wa.me link can be built from (lib/content/whatsapp.ts).
const phone = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .refine((value) => whatsappHref(value) !== null)

// join-form › photo_consent (CAP-40, story 2.13): two consents, the
// atmosphere photos (published) and the personal photos (the WhatsApp
// group), each with a title, a question (lines separated by "\n") and two
// answers, and one note under both. Flat fields, as the editor saves them.
const consentShort = z.string().trim().min(1).max(200)
const consentLong = z.string().trim().min(1).max(1000)

export const photoConsentSchema = z.object({
  atmosphere_title: consentShort,
  atmosphere_question: consentLong,
  atmosphere_yes: consentShort,
  atmosphere_no: consentShort,
  personal_title: consentShort,
  personal_question: consentLong,
  personal_yes: consentShort,
  personal_no: consentShort,
  note: consentLong,
})

export type PhotoConsentContent = z.infer<typeof photoConsentSchema>

// The two consents of the block.
export type PhotoConsentKind = "atmosphere" | "personal"

// One question of the block, for the fieldset.
export type PhotoConsentQuestion = {
  title: string
  question: string
  yesLabel: string
  noLabel: string
}

export function photoConsentQuestion(
  content: PhotoConsentContent,
  kind: PhotoConsentKind
): PhotoConsentQuestion {
  return kind === "atmosphere"
    ? {
        title: content.atmosphere_title,
        question: content.atmosphere_question,
        yesLabel: content.atmosphere_yes,
        noLabel: content.atmosphere_no,
      }
    : {
        title: content.personal_title,
        question: content.personal_question,
        yesLabel: content.personal_yes,
        noLabel: content.personal_no,
      }
}

// An image of a block (story 5.4): the media_assets row, its alt text
// (recommended, not required: user decision 2026-10-05; empty is alt="")
// and the focus point that stays in view in every aspect (object-position,
// percent). The file is never cropped.
const focus = z.number().int().min(0).max(100)

export const imageSchema = z.object({
  media_id: z.uuid(),
  alt: optionalText(300),
  focus_x: focus,
  focus_y: focus,
})

export type ImageContent = z.infer<typeof imageSchema>

// No field of the editor is required (user decision 2026-10-08) except
// three that stay as they were: the accessibility statement's fields, the
// two photo-consent texts and the business details' WhatsApp number. The
// site leaves out an empty heading, an item with nothing in it and a block
// with nothing at all (lib/content/visible.ts).

// home › hero (story 5.1): an optional title and description, and from
// 5.4 an optional photo. cta_label is no longer edited or shown (the hero has
// no button, user decision 2026-10-05); it stays optional so a hero
// published with it still parses (story 5.3).
export const heroSchema = z.object({
  title: optionalText(80),
  description: optionalText(300),
  cta_label: optionalText(40),
  image: imageSchema.optional(),
})

export type HeroContent = z.infer<typeof heroSchema>

// contact › business_details: one record for the whole site (tag
// content:global). Only the WhatsApp number is required.
export const businessDetailsSchema = z.object({
  whatsapp_phone: phone,
  business_name: optionalText(80),
  phone: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    phone.optional()
  ),
  whatsapp_message: optionalText(500),
  address: optionalText(200),
  arrival_instructions: optionalText(1000),
  navigation_url: z.preprocess(
    (value) =>
      typeof value === "string"
        ? value.trim() === ""
          ? undefined
          : value.trim()
        : value,
    z
      .url({ protocol: /^https$/ })
      .max(500)
      .optional()
  ),
  payment_instructions: optionalText(1000),
})

export type BusinessDetailsContent = z.infer<typeof businessDetailsSchema>

// Story 5.2: the kinds of the public pages. Each is shown only when it
// parses; a list without a visible item is not a section
// (lib/content/visible.ts).
const requiredText = (max: number) => z.string().trim().min(1).max(max)

// Story 5.3: a hidden section or item is published like any change and is
// not shown on the site or in the preview (lib/content/visible.ts).
const hidden = z.boolean().optional()

// A heading with its text (home › intro, home › contact, about › main,
// contact › intro). The body keeps its line breaks; it is optional, so a
// block can be a heading with an action (home › contact). An optional image
// (story 5.4; the editor offers it only in about › main).
export const textBlockSchema = z.object({
  eyebrow: optionalText(60),
  title: optionalText(120),
  body: optionalText(5000),
  image: imageSchema.optional(),
  hidden,
})

export type TextBlockContent = z.infer<typeof textBlockSchema>

// how-it-works › steps: an ordered list of steps.
export const stepsSchema = z.object({
  title: optionalText(120),
  items: z
    .array(
      z.object({
        title: optionalText(120),
        body: optionalText(1000),
        hidden,
      })
    )
    .min(0)
    .max(30),
  hidden,
})

export type StepsContent = z.infer<typeof stepsSchema>

// how-it-works › faq: questions and answers.
export const faqSchema = z.object({
  title: optionalText(120),
  items: z
    .array(
      z.object({
        question: optionalText(300),
        answer: optionalText(3000),
        hidden,
      })
    )
    .min(0)
    .max(60),
  hidden,
})

export type FaqContent = z.infer<typeof faqSchema>

// gallery › testimonials: a testimonial is text (a display name and the
// text) or, from story 5.4, an image (e.g. a screenshot Tal already edited;
// its alt is a short transcription) with an optional display name. An item
// saved before 5.4 has no kind and is text.
const textTestimonialSchema = z.object({
  kind: z.literal("text"),
  name: optionalText(80),
  text: optionalText(1500),
  hidden,
})

const imageTestimonialSchema = z.object({
  kind: z.literal("image"),
  image: imageSchema,
  name: optionalText(80),
  hidden,
})

export const testimonialsSchema = z.object({
  title: optionalText(120),
  items: z
    .array(
      z.preprocess(
        (item) =>
          item && typeof item === "object" && !("kind" in item)
            ? { ...item, kind: "text" }
            : item,
        z.discriminatedUnion("kind", [
          textTestimonialSchema,
          imageTestimonialSchema,
        ])
      )
    )
    .min(0)
    .max(60),
  hidden,
})

export type TestimonialsContent = z.infer<typeof testimonialsSchema>

// The gallery's columns on the phone (user decision 2026-10-08): 2, 3 or
// 4, chosen in the editor; missing means 3 (content published before has
// none; the site and the editor read it as 3). The editor sends its choice
// as text ("3").
export const GALLERY_COLUMNS = [2, 3, 4] as const
export type GalleryColumns = (typeof GALLERY_COLUMNS)[number]

const galleryColumns = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value.trim() === ""
        ? undefined
        : Number(value)
      : value,
  z.union([z.literal(2), z.literal(3), z.literal(4)]).optional()
)

// gallery › photos (story 5.4): the gallery, before the testimonials on
// /gallery. Each item is an image with an optional caption.
export const gallerySchema = z.object({
  title: optionalText(120),
  columns: galleryColumns,
  items: z
    .array(
      z.object({
        image: imageSchema,
        caption: optionalText(200),
        hidden,
      })
    )
    .min(0)
    .max(60),
  hidden,
})

export type GalleryContent = z.infer<typeof gallerySchema>

// site › footer (tag content:global, story 5.3): links shown in the footer
// (a display name and an https:// address, e.g. social networks). The old
// text still parses and is not shown; the editor saves only the items.
export const footerSchema = z.object({
  text: optionalText(500),
  items: z
    .array(
      z.object({
        label: optionalText(60),
        // Optional too (2026-10-08); a link is shown only with both.
        url: z.preprocess(
          (value) =>
            typeof value === "string" && value.trim() === ""
              ? undefined
              : value,
          z
            .string()
            .trim()
            .pipe(z.url({ protocol: /^https$/ }).max(500))
            .optional()
        ),
        hidden,
      })
    )
    .max(30)
    .optional(),
})

export type FooterContent = z.infer<typeof footerSchema>

// Story 5.5: the legal pages. None of them has `hidden` (an unknown key is
// dropped when parsing), so a legal text cannot be hidden from the site.
// Each body is plain text with a small formatting syntax
// (components/public/legal-text.tsx).
// privacy › body, terms › body (user decision 2026-10-06, after the phone
// check): the whole wording in one field, pasted as is; a line starting with
// "## " is a heading (h2 on the page).
export const legalTextSchema = z.object({
  body: optionalText(50000),
})

export type LegalTextContent = z.infer<typeof legalTextSchema>

// An email the statement's contact can be reached at (mailto:).
const email = z.string().trim().min(1).max(254).pipe(z.email())

// accessibility › statement (regulation 35, IS 5568; user decision
// 2026-10-06, second phone check): the whole statement in one text (the
// legal text's format) and the contact for accessibility. Every field is
// required, so it cannot be published without them; no hidden.
export const accessibilityStatementSchema = z.object({
  body: requiredText(50000),
  contact_name: requiredText(120),
  contact_phone: phone,
  contact_email: email,
})

export type AccessibilityStatementContent = z.infer<
  typeof accessibilityStatementSchema
>

// The statement's required fields, in the editor's order (the publish
// notice lists the missing ones).
export const ACCESSIBILITY_REQUIRED_FIELDS = [
  "body",
  "contact_name",
  "contact_phone",
  "contact_email",
] as const

// kind -> schema. A kind without a schema cannot be saved or published from
// the editor.
export const contentSchemas = {
  hero: heroSchema,
  business_details: businessDetailsSchema,
  photo_consent: photoConsentSchema,
  text_block: textBlockSchema,
  steps: stepsSchema,
  faq: faqSchema,
  testimonials: testimonialsSchema,
  gallery: gallerySchema,
  footer: footerSchema,
  legal_text: legalTextSchema,
  accessibility_statement: accessibilityStatementSchema,
} as const

export type ContentByKind = {
  [K in keyof typeof contentSchemas]: z.infer<(typeof contentSchemas)[K]>
}

export type ContentKind = keyof typeof contentSchemas

export function schemaForKind(kind: string) {
  return Object.hasOwn(contentSchemas, kind)
    ? contentSchemas[kind as ContentKind]
    : null
}

// The schema the editor and its Server Actions check a section with: the
// kind's schema (no section is stricter since 2026-10-08, when the bodies
// of home › intro, about › main and contact › intro stopped being
// required).
export function schemaForSection(_slug: string, _key: string, kind: string) {
  return schemaForKind(kind)
}
