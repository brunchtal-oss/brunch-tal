import { createHash, timingSafeEqual } from "node:crypto"

// Compares a secret a request brought with the expected one (the site lock,
// story 1.6; the job routes' CRON_SECRET, story 5.8). Both sides are hashed
// first, so the comparison takes the same time whatever the lengths.
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest()
  const b = createHash("sha256").update(expected, "utf8").digest()
  return timingSafeEqual(a, b)
}

/** The token of an `Authorization: Bearer <token>` header, else null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer +(\S+) *$/i.exec(header ?? "")
  return match ? match[1] : null
}
