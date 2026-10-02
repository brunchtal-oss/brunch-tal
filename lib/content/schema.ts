import { z } from "zod"

// One schema per content_sections.kind (AD-16). The editor (E5) checks
// against it before saving and the site parses with it; a block that does not
// match is not shown.

// join-form › photo_consent: the question (lines separated by "\n") and the
// two answers of the photo consent (CAP-40).
export const photoConsentSchema = z.object({
  question: z.string().trim().min(1),
  yes_label: z.string().trim().min(1),
  no_label: z.string().trim().min(1),
})

export type PhotoConsentContent = z.infer<typeof photoConsentSchema>

// contact › business_details. E5 adds the other fields (name, address,
// WhatsApp message, payment instructions).
export const businessDetailsSchema = z.object({
  whatsapp_phone: z.string().trim().min(1),
})

export type BusinessDetailsContent = z.infer<typeof businessDetailsSchema>
