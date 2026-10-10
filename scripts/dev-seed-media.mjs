// Dev only (story 5.4): puts the photos of photos/ (Tal's processed photos
// and the food, approved by the user on 2026-10-05) on the DEV Supabase
// project, through the same path as the admin screens: admin_create_media,
// the upload to media-drafts as the dev admin, admin_begin_media_publish,
// the copy to media-public (as lib/server/privileged/media.ts) and
// admin_finish_media_publish; then the content drafts and
// admin_publish_content, and admin_set_event_image for the sessions.
//
//   npm run dev:seed-media
//
// photos/Hero.png -> home › hero, photos/about.png -> about › main, the rest
// shuffled between gallery › photos and the upcoming published sessions
// without an image. Running it again adds nothing that is already there: a
// hero or about with an image, a gallery with photos and a session with an
// image are left as they are, and a photo that is already published (its
// alt text is on a published image) is not uploaded again.
// A page with a pending draft is not published (it would publish Tal's
// draft too). The site shows the change once its cache expires (minutes).
//
// It runs only against the DEV project: DEV_DATABASE_URL must exist and
// hold the project ref of NEXT_PUBLIC_SUPABASE_URL (as the database tests
// check); otherwise it stops before touching anything. The dev admin is
// dev-admin@example.com (node scripts/dev-reset-link.mjs --admin creates
// it); the script signs in as it with a one-time link it never prints.

import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { createClient } from "@supabase/supabase-js"

import { devRef } from "./dev-guard.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
if (!url || !secretKey || !publishableKey) {
  console.error(
    "חסרים NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY או SUPABASE_SECRET_KEY ב-.env.local"
  )
  process.exit(1)
}

// The DEV project only (the same check as supabase/tests/support/db.ts).
if (
  !devRef({ supabaseUrl: url, databaseUrl: process.env.DEV_DATABASE_URL })
) {
  console.error(
    "הסקריפט רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL. לא בוצע שום שינוי."
  )
  process.exit(1)
}

const PHOTOS_DIR = "photos"
const ADMIN_EMAIL = "dev-admin@example.com"
const OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

// Alt text (Hebrew) for each photo: Hero.png, about.png, and the numbered
// photos "ChatGPT Image Sep 23, 2026, 07_35_xx PM (n).png".
const HERO = {
  file: "Hero.png",
  alt: "שולחן בראנץ׳ ערוך מלמעלה: סלטים, ביצים אפויות, גזר צלוי, קרפצ׳יו סלק ופוקאצ׳ה",
  focus: [50, 50],
}
const ABOUT = {
  file: "about.png",
  alt: "טל עומדת מאחורי שולחן בראנץ׳ ערוך בבית",
  focus: [50, 30],
}
const NUMBERED_ALTS = {
  1: "קערה של דלעת צלויה עם קייל פריך וגבינה מפוררת",
  2: "סלט כרוב סגול, עשבי תיבול ובוטנים קצוצים בקערת עץ",
  3: "מחבת ביצים אפויות עם תרד ובצל ירוק",
  4: "טל מגישה קערת דלעת צלויה עם קייל במטבח",
  5: "סלט כרוב סגול עם מנגו, מלפפון ובוטנים, ולידו קרפצ׳יו דג",
  6: "ארבעה ממרחים צבעוניים וקרקרים של זרעים",
  7: "שולחן בראנץ׳ ערוך: פוקאצ׳ה, קרפצ׳יו דג, סלטים וממרחים",
  8: "טל ליד שולחן בראנץ׳ ערוך בסלון מואר",
  9: "סלט פסטה עם קישואים, ולידו גזר צלוי וסלטים",
  10: "גזר צלוי לצד גבינה לבנה עם שמן עשבי תיבול",
  11: "שולחן בראנץ׳ עם פוקאצ׳ה, סלט ירוק וממרחים",
  12: "גזר צלוי עם גבינה לבנה, ומאחור מחבת שקשוקה",
  13: "קרפצ׳יו סלק עם גבינה מפוררת, ומאחור מאפים ומחבת שקשוקה",
  14: "סלט ירוק עם קינואה ושקדים פרוסים",
  15: "ממרחים צבעוניים בקערות קטנות ליד קרקרים של זרעים",
}
const FALLBACK_ALT = "מנה מבראנץ׳ אצל טל"

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }

function contentType(file) {
  const ext = file.slice(file.lastIndexOf(".")).toLowerCase()
  return TYPES[ext] ?? null
}

function altFor(file) {
  const match = /07_35_\d\d PM \((\d+)\)/.exec(file)
  return (match && NUMBERED_ALTS[Number(match[1])]) || FALLBACK_ALT
}

function shuffle(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const service = createClient(url, secretKey, OPTIONS)

async function findAdmin() {
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) throw new Error(`listUsers failed: ${error.code ?? error.status}`)
    const user = data.users.find((u) => u.email?.toLowerCase() === ADMIN_EMAIL)
    if (user) return user
    if (data.users.length < 1000) return null
  }
}

// A client signed in as the dev admin (a one-time link, never printed).
async function adminClient() {
  const user = await findAdmin()
  if (!user) {
    console.error(
      `אין אדמין פיתוח (${ADMIN_EMAIL}). קודם: node scripts/dev-reset-link.mjs --admin`
    )
    process.exit(1)
  }
  const { data: role } = await service
    .from("admin_roles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!role) {
    console.error(`${ADMIN_EMAIL} אינה אדמין. קודם: node scripts/dev-reset-link.mjs --admin`)
    process.exit(1)
  }
  const { data, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: ADMIN_EMAIL,
  })
  if (error) throw new Error(`generateLink failed: ${error.code ?? error.status}`)
  const client = createClient(url, publishableKey, OPTIONS)
  const verified = await client.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  })
  if (verified.error) {
    throw new Error(`verifyOtp failed: ${verified.error.code ?? verified.error.status}`)
  }
  return client
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name} failed: ${error.message}`)
  return data
}

// One photo through the whole publish path; returns its media id.
async function publishPhoto(admin, file, alt, [focusX, focusY]) {
  const type = contentType(file)
  if (!type) throw new Error(`unsupported file: ${file}`)
  const created = await rpc(admin, "admin_create_media", {
    p_idempotency_key: randomUUID(),
  })
  const id = created.media_id
  const upload = await admin.storage
    .from("media-drafts")
    .upload(id, readFileSync(join(PHOTOS_DIR, file)), {
      contentType: type,
      cacheControl: "600",
      upsert: false,
    })
  if (upload.error) throw new Error(`upload failed: ${upload.error.message}`)
  await rpc(admin, "admin_begin_media_publish", {
    p_media_id: id,
    p_alt_text: alt,
    p_focus_x: focusX,
    p_focus_y: focusY,
  })
  const copied = await service.storage
    .from("media-drafts")
    .copy(id, `${id}.jpg`, { destinationBucket: "media-public" })
  if (copied.error && copied.error.statusCode !== "409") {
    throw new Error(`copy failed: ${copied.error.message}`)
  }
  await rpc(admin, "admin_finish_media_publish", { p_media_id: id })
  console.log(`הועלתה: ${file}`)
  return id
}

function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

// A page whose sections have no pending draft (publishing it publishes only
// what the script changes).
function hasPendingDraft(page) {
  return page.sections.some(
    (s) =>
      s.draft_content &&
      Object.keys(s.draft_content).length > 0 &&
      !sameJson(s.draft_content, s.published_content)
  )
}

async function publishPage(admin, slug) {
  const result = await rpc(admin, "admin_publish_content", {
    p_slug: slug,
    p_idempotency_key: randomUUID(),
  })
  const paths = result.hidden_paths ?? []
  if (paths.length > 0) {
    await service.storage.from("media-public").remove(paths)
  }
}

const image = (id, alt, [x, y]) => ({ media_id: id, alt, focus_x: x, focus_y: y })

// home › hero and about › main: an image is added to the published section.
async function seedBlock(admin, slug, key, photo, files, required) {
  if (!files.includes(photo.file)) {
    console.log(`אין ${PHOTOS_DIR}/${photo.file}, מדלגת על ${slug}/${key}`)
    return
  }
  const page = await rpc(admin, "admin_get_content_page", { p_slug: slug })
  const section = page.sections.find((s) => s.key === key)
  const current = section?.draft_content ?? section?.published_content ?? null
  if (current?.image) {
    console.log(`${slug}/${key} כבר עם תמונה`)
    return
  }
  const published = section?.published_content
  if (!published || required.some((field) => !published[field])) {
    console.log(`${slug}/${key} עוד לא פורסם עם טקסט, מדלגת`)
    return
  }
  if (hasPendingDraft(page)) {
    console.log(`בעמוד ${slug} יש טיוטה שלא פורסמה, מדלגת`)
    return
  }
  const id = await publishPhoto(admin, photo.file, photo.alt, photo.focus)
  await rpc(admin, "admin_set_content_draft", {
    p_slug: slug,
    p_key: key,
    p_content: { ...published, image: image(id, photo.alt, photo.focus) },
  })
  await publishPage(admin, slug)
  console.log(`${slug}/${key}: התמונה פורסמה`)
}

async function main() {
  if (!existsSync(PHOTOS_DIR)) {
    console.error(`אין תיקייה ${PHOTOS_DIR}/`)
    process.exit(1)
  }
  const files = readdirSync(PHOTOS_DIR).filter((f) => contentType(f))
  const admin = await adminClient()
  try {
    await seedBlock(admin, "home", "hero", HERO, files, ["title"])
    await seedBlock(admin, "about", "main", ABOUT, files, ["title", "body"])

    // The rest: the gallery (when it has no photos) and the upcoming
    // published sessions without an image. A photo already published by an
    // earlier run (its alt text is on a published image) is not uploaded
    // again.
    const { data: published, error: mediaError } = await admin
      .from("media_assets")
      .select("alt_text")
      .eq("publish_state", "published")
    if (mediaError) throw new Error(`media read failed: ${mediaError.message}`)
    const usedAlts = new Set(published.map((row) => row.alt_text))
    const rest = shuffle(
      files.filter(
        (f) => f !== HERO.file && f !== ABOUT.file && !usedAlts.has(altFor(f))
      )
    )
    const gallery = await rpc(admin, "admin_get_content_page", {
      p_slug: "gallery",
    })
    const photos = gallery.sections.find((s) => s.key === "photos")
    const galleryContent =
      photos?.draft_content ?? photos?.published_content ?? null
    const galleryEmpty = !(galleryContent?.items?.length > 0)
    const galleryBlocked = galleryEmpty && hasPendingDraft(gallery)
    if (!galleryEmpty) console.log("בגלריה כבר יש תמונות")
    if (galleryBlocked) console.log("בעמוד הגלריה יש טיוטה שלא פורסמה, מדלגת")

    const { data: events, error } = await admin
      .from("events")
      .select("id")
      .eq("status", "published")
      .is("image_id", null)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at")
    if (error) throw new Error(`events read failed: ${error.message}`)

    const forGallery = galleryEmpty && !galleryBlocked
    const eventCount = forGallery
      ? Math.min(events.length, Math.floor(rest.length / 2))
      : Math.min(events.length, rest.length)
    const eventFiles = rest.slice(0, eventCount)
    const galleryFiles = forGallery ? rest.slice(eventCount) : []

    for (let i = 0; i < eventFiles.length; i++) {
      const file = eventFiles[i]
      const id = await publishPhoto(admin, file, altFor(file), [50, 50])
      const result = await rpc(admin, "admin_set_event_image", {
        p_event_id: events[i].id,
        p_media_id: id,
      })
      if (result.hidden_paths?.length) {
        await service.storage.from("media-public").remove(result.hidden_paths)
      }
    }
    if (eventFiles.length > 0) {
      console.log(`${eventFiles.length} מפגשים קיבלו תמונה`)
    } else if (events.length === 0) {
      console.log("אין מפגשים עתידיים שפורסמו בלי תמונה")
    }

    if (galleryFiles.length > 0) {
      const items = []
      for (const file of galleryFiles) {
        const alt = altFor(file)
        const id = await publishPhoto(admin, file, alt, [50, 50])
        items.push({ image: image(id, alt, [50, 50]) })
      }
      await rpc(admin, "admin_set_content_draft", {
        p_slug: "gallery",
        p_key: "photos",
        p_content: { ...(galleryContent ?? {}), items },
      })
      await publishPage(admin, "gallery")
      console.log(`הגלריה פורסמה עם ${items.length} תמונות`)
    }
  } finally {
    // Local only: the default (global) would end every session of the dev
    // admin on all devices.
    await admin.auth.signOut({ scope: "local" })
  }
  console.log("")
  console.log("האתר יציג את השינוי כשהמטמון שלו יתחדש (כמה דקות).")
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
