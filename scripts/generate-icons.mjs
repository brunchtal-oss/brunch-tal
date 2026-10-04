// Generates the PWA icons (story 5.9) into public/icons/: "a plate seen
// from above" — an olive field, a cream plate and a thin ring on it, no
// text. Run once after changing the drawing: `node scripts/generate-icons.mjs`.
// The PNGs are committed.
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

import sharp from "sharp"

const OLIVE = "#4A4A2A"
const CREAM = "#FAF6EE"
const RING = "#8A875A"

const OUT = fileURLToPath(new URL("../public/icons/", import.meta.url))

// plate: the plate's radius as a share of the side. A maskable icon keeps
// everything inside the 80% safe circle, so its plate is smaller.
function svg(size, plate) {
  const c = size / 2
  const r = size * plate
  const ring = r * 0.72
  const stroke = Math.max(1, size * 0.012)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${OLIVE}"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="${CREAM}"/>
  <circle cx="${c}" cy="${c}" r="${ring}" fill="none" stroke="${RING}" stroke-width="${stroke}"/>
</svg>`
}

const ICONS = [
  { file: "icon-192.png", size: 192, plate: 0.36 },
  { file: "icon-512.png", size: 512, plate: 0.36 },
  { file: "icon-maskable-512.png", size: 512, plate: 0.3 },
  { file: "apple-touch-icon.png", size: 180, plate: 0.34 },
]

mkdirSync(OUT, { recursive: true })
for (const { file, size, plate } of ICONS) {
  await sharp(Buffer.from(svg(size, plate)))
    .png()
    .toFile(OUT + file)
  console.log(`public/icons/${file}`)
}
