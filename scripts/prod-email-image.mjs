// Story 6.11: the system emails' header image on the PRODUCTION project
// (see scripts/email-image.mjs), through the prod guard (prod-env.mjs).
//
//   node scripts/prod-email-image.mjs --file <path>           (dry run)
//   node scripts/prod-email-image.mjs --file <path> --apply   (uploads)
//
// The dry run only reads: the file's check, whether media-public exists and
// is public on prod, whether Vault email_image_url exists, and what would be
// done. --apply uploads to media-public/email/header.jpg (upsert) and checks
// that the public URL answers; it runs only with the user's explicit OK for
// that step. Vault is never written by the script (its database role may
// not, 42501 on dev): both runs print the one SQL Editor line that sets
// email_image_url, for the user to run in prod's SQL Editor. The database
// session is read only. No key or connection string is printed.

import {
  bucketState,
  EMAIL_IMAGE_BUCKET,
  EMAIL_IMAGE_PATH,
  EMAIL_IMAGE_SECRET,
  emailImageUrl,
  readImageArg,
  uploadEmailImage,
  vaultHasImage,
  vaultInstructions,
} from "./email-image.mjs"
import { connect, loadProdConfig, serviceClient } from "./prod-env.mjs"

const apply = process.argv.includes("--apply")
const config = loadProdConfig()
const { bytes } = readImageArg(process.argv)

const service = serviceClient(config.supabaseUrl, config.secretKey)
const state = await bucketState(service)
const url = emailImageUrl(config.supabaseUrl)

const db = await connect(config.databaseUrl, {
  readOnly: true,
  label: "פרודקשן",
})
let exists = null
try {
  exists = await vaultHasImage(db)
} finally {
  await db.end().catch(() => {})
}

console.log(`פרויקט: ${config.ref}`)
console.log(
  `הדלי ${EMAIL_IMAGE_BUCKET}: ${state === "public" ? "קיים וציבורי" : state === "private" ? "קיים אבל לא ציבורי" : "לא קיים"}`
)
console.log(`הקובץ: ${Math.round(bytes.length / 1024)}KB, JPEG`)
console.log(`יעד: ${EMAIL_IMAGE_BUCKET}/${EMAIL_IMAGE_PATH} (upsert)`)
console.log(
  `Vault ${EMAIL_IMAGE_SECRET}: ${exists === null ? "לא ניתן לקרוא" : exists ? "קיים" : "לא קיים"}; הכתובת: ${url}`
)

if (state !== "public") {
  console.error("אין דלי ציבורי media-public בפרודקשן. לא בוצע שום שינוי.")
  process.exit(1)
}
if (!apply) {
  console.log("הרצה יבשה: שום דבר לא הועלה. להעלאה: --apply (באישור).")
} else {
  try {
    await uploadEmailImage({
      service,
      supabaseUrl: config.supabaseUrl,
      bytes,
    })
    console.log("הקובץ הועלה, והכתובת הציבורית עונה.")
  } catch (error) {
    console.error(error?.message ?? "שגיאה")
    process.exit(1)
  }
}
for (const line of vaultInstructions(url, exists)) console.log(line)
