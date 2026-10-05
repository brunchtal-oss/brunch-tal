// Preparing an image in the browser before it is uploaded (story 5.4): the
// longest side down to 2000px and a JPEG at 0.85. Drawing on a canvas also
// drops the EXIF data (a GPS location). Types: jpeg, png, webp (an iPhone
// turns HEIC into JPEG on its own when a page asks for these).

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export const ACCEPT = ACCEPTED_TYPES.join(",")

// The bucket's limit (media-drafts, 5MB).
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
// A chosen file larger than this is refused before it is read (a phone's
// photo is far smaller).
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024
export const MAX_SIDE = 2000
export const JPEG_QUALITY = 0.85

export type ImageProblem = "notSupported" | "tooLarge"

// What is wrong with a chosen file before it is read, or null.
export function checkSource(file: { type: string; size: number }) {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "notSupported" as const
  }
  if (file.size > MAX_SOURCE_BYTES) return "tooLarge" as const
  return null
}

// The size that fits within max on its longest side (never enlarged).
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_SIDE
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// The resized JPEG of a chosen file. Throws when the browser cannot read it.
export async function resizeToJpeg(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  })
  try {
    const size = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("no canvas")
    // A transparent PNG becomes white, not black, as a JPEG.
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("no blob"))),
        "image/jpeg",
        JPEG_QUALITY
      )
    )
  } finally {
    bitmap.close()
  }
}

// The part of an image (percent of its width and height) that an aspect
// shows with object-fit: cover and object-position at the focus point.
export function cropFrame(
  imageRatio: number,
  targetRatio: number,
  focusX: number,
  focusY: number
): { left: number; top: number; width: number; height: number } {
  if (targetRatio <= 0 || imageRatio <= 0) {
    return { left: 0, top: 0, width: 100, height: 100 }
  }
  const width =
    targetRatio < imageRatio ? (targetRatio / imageRatio) * 100 : 100
  const height =
    targetRatio < imageRatio ? 100 : (imageRatio / targetRatio) * 100
  return {
    left: ((100 - width) * focusX) / 100,
    top: ((100 - height) * focusY) / 100,
    width,
    height,
  }
}

// A focus value moved by a step, within 0..100.
export function moveFocus(value: number, delta: number): number {
  return Math.min(100, Math.max(0, Math.round(value + delta)))
}
