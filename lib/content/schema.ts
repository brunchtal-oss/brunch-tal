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

// join-form › photo_consent: the question (lines separated by "\n") and the
// two answers of the photo consent (CAP-40).
export const photoConsentSchema = z.object({
  question: z.string().trim().min(1),
  yes_label: z.string().trim().min(1),
  no_label: z.string().trim().min(1),
})

export type PhotoConsentContent = z.infer<typeof photoConsentSchema>

// home › hero (story 5.1): the title, an optional description and the label
// of the button to the sessions. The photo arrives in 5.4.
export const heroSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: optionalText(300),
  cta_label: z.string().trim().min(1).max(40),
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
// parses; a list without items is not a section.
const requiredText = (max: number) => z.string().trim().min(1).max(max)

// A heading with its text (home › intro, home › contact, about › main,
// contact › intro). The body keeps its line breaks; it is optional, so a
// block can be a heading with an action (home › contact).
export const textBlockSchema = z.object({
  eyebrow: optionalText(60),
  title: requiredText(120),
  body: optionalText(5000),
})

export type TextBlockContent = z.infer<typeof textBlockSchema>

// how-it-works › steps: an ordered list of steps.
export const stepsSchema = z.object({
  title: optionalText(120),
  items: z
    .array(z.object({ title: requiredText(120), body: requiredText(1000) }))
    .min(1)
    .max(30),
})

export type StepsContent = z.infer<typeof stepsSchema>

// how-it-works › faq: questions and answers.
export const faqSchema = z.object({
  title: optionalText(120),
  items: z
    .array(
      z.object({ question: requiredText(300), answer: requiredText(3000) })
    )
    .min(1)
    .max(60),
})

export type FaqContent = z.infer<typeof faqSchema>

// gallery › testimonials: text testimonials (a display name and the text;
// images come in 5.4).
export const testimonialsSchema = z.object({
  title: optionalText(120),
  items: z
    .array(z.object({ name: requiredText(80), text: requiredText(1500) }))
    .min(1)
    .max(60),
})

export type TestimonialsContent = z.infer<typeof testimonialsSchema>

// site › footer: the footer's text (tag content:global).
export const footerSchema = z.object({
  text: requiredText(500),
})

export type FooterContent = z.infer<typeof footerSchema>

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
  footer: footerSchema,
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
