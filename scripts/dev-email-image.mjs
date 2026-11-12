// Story 6.11: the system emails' header image on the DEV project (see
// scripts/email-image.mjs). Uploads the small JPEG to
// media-public/email/header.jpg (upsert), checks that its public URL
// answers, and prints the one SQL Editor line that sets Vault
// email_image_url (the user runs it; the script never writes Vault).
//
//   node scripts/dev-email-image.mjs --file <path to the small JPEG>
//
// It runs only against the DEV project: DEV_DATABASE_URL must hold the ref
// of NEXT_PUBLIC_SUPABASE_URL (dev-guard). No key or connection string is
// printed.

import { existsSync } from "node:fs"

import { createClient } from "@supabase/supabase-js"
import pg from "pg"

import { devRef } from "./dev-guard.mjs"
import {
  bucketState,
  EMAIL_IMAGE_BUCKET,
  EMAIL_IMAGE_PATH,
  readImageArg,
  uploadEmailImage,
  vaultHasImage,
  vaultInstructions,
} from "./email-image.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const databaseUrl = process.env.DEV_DATABASE_URL
if (!url || !secretKey || !databaseUrl) {
  console.error(
    "חסרים NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY או DEV_DATABASE_URL ב-.env.local"
  )
  process.exit(1)
}
if (!devRef({ supabaseUrl: url, databaseUrl })) {
  console.error(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL. לא בוצע שום שינוי."
  )
  process.exit(1)
}

const { bytes } = readImageArg(process.argv)

const service = createClient(url, secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})
const state = await bucketState(service)
if (state !== "public") {
  console.error(
    `הדלי ${EMAIL_IMAGE_BUCKET} ${state === "missing" ? "לא קיים" : "אינו ציבורי"} בפיתוח. לא בוצע שום שינוי.`
  )
  process.exit(1)
}

try {
  const imageUrl = await uploadEmailImage({ service, supabaseUrl: url, bytes })
  console.log(
    `הועלה: ${EMAIL_IMAGE_BUCKET}/${EMAIL_IMAGE_PATH} (${Math.round(bytes.length / 1024)}KB); הכתובת הציבורית עונה.`
  )

  // Only a read: whether the secret exists, to print the right line.
  const parsed = new URL(databaseUrl)
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    parsed.searchParams.delete(key)
  }
  const db = new pg.Client({
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  })
  db.on("error", () => {})
  let exists = null
  try {
    await db.connect()
    await db.query("set default_transaction_read_only = on")
    exists = await vaultHasImage(db)
  } catch {
    exists = null
  } finally {
    await db.end().catch(() => {})
  }
  for (const line of vaultInstructions(imageUrl, exists)) console.log(line)
} catch (error) {
  console.error(error?.message ?? "שגיאה")
  process.exitCode = 1
}
