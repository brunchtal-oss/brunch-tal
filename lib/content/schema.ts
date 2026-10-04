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

// kind -> schema. A kind without a schema cannot be saved or published from
// the editor.
export const contentSchemas = {
  hero: heroSchema,
  business_details: businessDetailsSchema,
  photo_consent: photoConsentSchema,
} as const

export type ContentKind = keyof typeof contentSchemas

export function schemaForKind(kind: string) {
  return Object.hasOwn(contentSchemas, kind)
    ? contentSchemas[kind as ContentKind]
    : null
}
