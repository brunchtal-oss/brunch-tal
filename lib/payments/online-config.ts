// Online payments with Grow (morning): the server kill switch and the
// provider's settings, read from server env only (never NEXT_PUBLIC_*).
//
// onlinePaymentsEnabled: ONLINE_PAYMENTS_ENABLED=true and every Grow var
// present. Off, no checkout starts (startCheckout answers
// ONLINE_PAYMENTS_OFF) and the screens stay as today (PR B).
// growConfig: the Grow vars alone, without the switch. The notification
// route and the browser return use it, so a checkout that started before
// the switch went off is still confirmed.

export type GrowEnvName = "sandbox" | "production"

// 320 tax invoice / receipt, 400 receipt (an exempt business, user decision
// 2026-11-20).
export type GrowDocumentType = 320 | 400

export type GrowConfig = {
  env: GrowEnvName
  // The token host (POST {idpUrl}/idp/v1/oauth/token).
  idpUrl: string
  // The API base (POST {apiUrl}/payments/form, /documents/search).
  apiUrl: string
  clientId: string
  clientSecret: string
  pluginId: string
  documentType: GrowDocumentType
}

export type OnlinePaymentsEnv = {
  ONLINE_PAYMENTS_ENABLED?: string
  GROW_ENV?: string
  GROW_CLIENT_ID?: string
  GROW_CLIENT_SECRET?: string
  GROW_PLUGIN_ID?: string
  GROW_DOCUMENT_TYPE?: string
  [name: string]: string | undefined
}

const HOSTS: Record<GrowEnvName, { idpUrl: string; apiUrl: string }> = {
  production: {
    idpUrl: "https://api.morning.co",
    apiUrl: "https://api.greeninvoice.co.il/api/v1",
  },
  sandbox: {
    idpUrl: "https://api.sandbox.morning.dev",
    apiUrl: "https://sandbox.d.greeninvoice.co.il/api/v1",
  },
}

// Trimmed: a value pasted into the Vercel dashboard may carry a stray space.
function read(env: OnlinePaymentsEnv, name: string): string {
  return (env[name] ?? "").trim()
}

export function growConfig(
  env: OnlinePaymentsEnv = process.env
): GrowConfig | null {
  const name = read(env, "GROW_ENV")
  if (name !== "sandbox" && name !== "production") return null
  const clientId = read(env, "GROW_CLIENT_ID")
  const clientSecret = read(env, "GROW_CLIENT_SECRET")
  const pluginId = read(env, "GROW_PLUGIN_ID")
  const type = read(env, "GROW_DOCUMENT_TYPE")
  if (!clientId || !clientSecret || !pluginId) return null
  if (type !== "320" && type !== "400") return null
  return {
    env: name,
    ...HOSTS[name],
    clientId,
    clientSecret,
    pluginId,
    documentType: type === "320" ? 320 : 400,
  }
}

export function onlinePaymentsEnabled(
  env: OnlinePaymentsEnv = process.env
): boolean {
  return (
    read(env, "ONLINE_PAYMENTS_ENABLED") === "true" && growConfig(env) !== null
  )
}
