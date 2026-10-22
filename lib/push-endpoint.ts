// A push endpoint of a known push service only (story 5.20, user decision
// 2026-10-22): https, a lowercase host that is exactly fcm.googleapis.com or
// updates.push.services.mozilla.com, or ends with .push.apple.com or
// .notify.windows.com; no userinfo ("@" anywhere), port absent or 443, at
// most 1000 characters. The same rule as private.push_endpoint_allowed
// (register_push_subscription); the push worker checks it again before
// sending, so a row saved before the rule is never sent to.

const SHAPE = /^https:\/\/([a-z0-9.-]+)(?::443)?(?:\/\S*)?$/
const EXACT_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
])
const SUFFIX_HOST = /^([a-z0-9-]+\.)+(push\.apple\.com|notify\.windows\.com)$/

export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== "string") return false
  if (endpoint.length > 1000 || endpoint.includes("@")) return false
  const match = SHAPE.exec(endpoint)
  if (!match) return false
  const host = match[1]
  return EXACT_HOSTS.has(host) || SUFFIX_HOST.test(host)
}
