---
name: pwa-push-notifications
description: >
  Implements Web Push Notifications in a Next.js PWA correctly — end to end.
  Covers VAPID keys, service worker setup, Supabase subscriptions table,
  subscribe/send API routes, middleware whitelist, iOS requirements, and a
  debug checklist. Special note for Next.js 16 + Turbopack (next-pwa is a
  no-op). Triggers on: "add push notifications", "implement push", "web push",
  "PWA notifications", "send push to users".
---

# PWA Push Notifications — Next.js

Built from real production experience. Every pitfall below was hit and fixed.

---

## 🏠 THIS PROJECT (brunch-at-tals) — read first

`ARCHITECTURE-SPINE.md` (AD-11, AD-12, AD-13, AD-16) wins over this skill.
Next is 16 → **Step 2B path only**. Use this skill for its pitfalls and
debug checklist, not for its data-access code.

**Use as-is:** static hand-written `public/sw.js` (`// @ts-check`, no next-pwa),
`Cache-Control: no-cache` on `/sw.js`, manual registration, VAPID key as
`Uint8Array<ArrayBuffer>` (Step 8), permission only from a click (Step 11),
close the UI before subscribing (Step 9), self-heal sync on load (Step 10),
exact icon paths, the debug checklist.

**Replace with the project's way:**

| Skill says | Here instead |
|---|---|
| `/api/push/subscribe` route with `.from('push_subscriptions').insert/delete` | Server Action → `callRpc` → `register_push_subscription(p_endpoint, p_keys, p_platform)`; `unregister_push_subscription` on logout. Lint blocks direct writes. |
| Zod flat payload `{endpoint, p256dh, auth}` | Match the RPC signature: `p_keys` holds `p256dh` + `auth`. |
| Send push from an API route on demand | Never from a transaction. `private.enqueue_notification` → `notification_jobs` → pg_cron → `POST /api/jobs/push` (Bearer `CRON_SECRET`, `timingSafeEqual`) → `lib/server/privileged/push-worker.ts`. |
| On 410 mark inactive | 404/410 delete the subscription; 401/403 keep it; record `notification_deliveries` so retries skip delivered ones. |
| Middleware `PUBLIC_PREFIXES` | `proxy.ts` + `lib/site-lock.ts`: machine-to-machine paths go only in `SITE_LOCK_EXEMPT_PREFIXES` and verify their own secret. `/sw.js`, manifest and icons must load for the installed app. |
| `notificationclick` opens `data.url` | Opens `target_path` (`/me…` for customers, `/admin…` for admins). Every `push` event ends in `showNotification` (no silent push on iOS). |
| SW may cache freely | Cache only `/_next/static`, icons and `/offline`. Never `/me`, `/admin` HTML or `/api`. Navigation network-only with `/offline` fallback. |
| `VAPID_SUBJECT=mailto:you@example.com` | The business `mailto:` (Apple returns 403 on a bad value). Private key server-only, one VAPID pair per Supabase project. |
| `create table push_subscriptions …` here | Migration via `npx supabase migration new`, RLS `user_id = (select auth.uid())`, explicit grants, then `get_advisors`. |
| Toast text in English | Hebrew micro-copy in `lib/copy/*`, errors via `lib/errors.ts`. |

Building the enable-notifications prompt or settings screen starts with the
`frontend-design` skill (project rule).

---

## ⚠️ CRITICAL — Next.js Version First

**Next.js 16+ uses Turbopack by default.** `@ducanh2912/next-pwa` (and similar
webpack-based PWA plugins) **silently do nothing** under Turbopack — the build
succeeds, but `public/sw.js` is never emitted, so `/sw.js` returns 404, and
`navigator.serviceWorker.ready` never resolves. Push permission can still be
granted by the browser, but `pushManager.subscribe()` never completes, so the
DB stays empty and no notifications are ever sent.

**Symptom:** "Permission granted in iOS Settings, but the DB has 0 subscriptions."

**Rule:**

| Stack | Approach |
|---|---|
| Next.js ≤ 15 with webpack | `@ducanh2912/next-pwa` works (Steps below). |
| Next.js 16+ (Turbopack) | **Do NOT use next-pwa.** Use static `public/sw.js` + manual registration (see "Next 16 Path" below). |

Confirm which path you need before writing anything:

```bash
curl -sI https://yourapp.com/sw.js   # 200 = working, 404 = not emitted
```

If a `withPWA` wrapper exists in `next.config` of a Next 16 project, that is
the bug — it's deceiving everyone into thinking PWA is set up.

---

## Step 1 — Generate VAPID Keys

Run once, store in `.env.local`:

```bash
npx web-push generate-vapid-keys
```

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

---

## Step 2A — Service Worker (Next ≤ 15, next-pwa path) ⚠️ PITFALL #1

`customWorkerSrc` is a **directory**, not a filename.

```ts
// next.config.ts
import withPWA from "@ducanh2912/next-pwa";

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  customWorkerSrc: "worker",   // ← directory name, NOT "sw-custom.js"
})(nextConfig);
```

next-pwa looks for `worker/index.js` (or `worker/index.ts`) inside that directory,
compiles it, and injects it into the generated `sw.js` via `importScripts("/worker-HASH.js")`.

Create `worker/index.js`:

```js
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "New notification", {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      data: { url: data.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const url = event.notification.data?.url ?? "/";
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
```

**Icon paths must be exact filenames in `public/icons/`.** A wrong path causes
`showNotification` to fail silently on iOS — no error, no notification.

---

## Step 2B — Service Worker (Next 16+ / Turbopack path)

Remove `@ducanh2912/next-pwa` entirely. Create the service worker as a static
file at `public/sw.js`:

```js
// public/sw.js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'App', {
      body: data.body || '',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus() }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
```

Add headers in `next.config.ts`:

```ts
async headers() {
  return [{
    source: '/sw.js',
    headers: [
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Service-Worker-Allowed', value: '/' },
    ],
  }]
}
```

Register it manually from a client component mounted in the root layout:

```tsx
// components/ServiceWorkerRegister.tsx
'use client'
import { useEffect } from 'react'
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((err) => console.error('SW register failed:', err))
  }, [])
  return null
}
```

Mount once in `app/layout.tsx` body. After this, `curl /sw.js` must return 200.

---

## Step 3 — Middleware Whitelist ⚠️ PITFALL #2

If your middleware redirects unauthenticated requests, it will silently
break service worker loading. Always whitelist these paths:

```ts
const PUBLIC_PREFIXES = [
  "/_next",
  "/icons",
  "/manifest.json",
  "/sw.js",
  "/workbox-",
  "/worker-",   // ← needed for next-pwa's importScripts
];
```

The `/worker-` prefix is critical on the next-pwa path: `sw.js` does
`importScripts('/worker-HASH.js')`, and a 307 redirect there silently
disables the push listener.

---

## Step 4 — DB Schema (Supabase) ⚠️ PITFALL #3 (UNIQUE constraint)

If you intend to use `.upsert(..., { onConflict: 'endpoint' })` on the server,
you **must** declare a `UNIQUE` constraint on `endpoint` in the table. Without
it, every upsert errors 500 silently and no row is ever saved.

Safer pattern: skip upsert entirely, use delete-then-insert (see Step 6).

```sql
create table push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  is_active    boolean default true,
  created_at   timestamptz default now(),
  last_used_at timestamptz
  -- Add UNIQUE(endpoint) only if you actually want to use upsert on it.
);

create index on push_subscriptions(user_id);
```

---

## Step 5 — Payload Shape: Client/Server Contract ⚠️ PITFALL #4

The most common silent-fail bug: **client sends one shape, server expects
another, Zod returns 400, nothing is saved.**

Pick ONE shape and use it on both sides. Recommended: flat shape, because it
matches how the row lives in DB.

**Client (always):**

```ts
const json = sub.toJSON()
await fetch('/api/push/subscribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    user_agent: navigator.userAgent,
  }),
})
```

**Server schema (must match):**

```ts
export const SubscribePushSchema = z.object({
  endpoint: z.string().url(),
  p256dh:   z.string().min(1),
  auth:     z.string().min(1),
  user_agent: z.string().optional(),
})
```

Do NOT send `{ subscription: sub.toJSON() }` with a flat schema, or vice versa.

---

## Step 6 — Subscribe API Route

Use delete-then-insert to avoid the upsert/UNIQUE-constraint pitfall:

```ts
// app/api/push/subscribe/route.ts
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import { SubscribePushSchema } from '@/types/api'

export async function POST(request: Request) {
  const session = await getSession()
  if (!session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = SubscribePushSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const { endpoint, p256dh, auth, user_agent } = parsed.data
  const db = createServerClient()

  // Delete by endpoint, then insert fresh — no UNIQUE constraint needed.
  await db.from('push_subscriptions').delete().eq('endpoint', endpoint)

  const { error } = await db.from('push_subscriptions').insert({
    user_id: session.userId,
    endpoint, p256dh, auth, user_agent,
    is_active: true,
    last_used_at: new Date().toISOString(),
  })

  if (error) {
    console.error('push subscribe insert failed:', error)
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
```

Always log the insert error — silent 500s are the #1 reason these bugs
survive in production.

---

## Step 7 — Send Push API Route

```ts
import webpush from 'web-push'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

// On 410 Gone, mark the subscription inactive (browser unsubscribed).
```

---

## Step 8 — VAPID Key Must Be Uint8Array on iOS ⚠️ PITFALL #5

`pushManager.subscribe({ applicationServerKey })` accepts a base64url string
in Chrome but **iOS Safari silently rejects strings** — permission is granted
in Settings but `subscribe()` never resolves a subscription. Always convert:

```ts
// lib/push/client.ts
// Return Uint8Array<ArrayBuffer> — Next 16's stricter lib types reject
// the default Uint8Array<ArrayBufferLike> as not assignable to BufferSource.
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const buffer = new ArrayBuffer(raw.length)
  const arr = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}
```

```ts
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
})
```

**TypeScript note for Next 16:** the return type must be
`Uint8Array<ArrayBuffer>` (not the default `Uint8Array<ArrayBufferLike>`),
otherwise the build fails with:

```
Type 'Uint8Array<ArrayBufferLike>' is not assignable to type
'string | BufferSource | null | undefined'.
```

Building a fresh `ArrayBuffer` (instead of reading `Uint8Array.buffer`) is
what makes the narrower type land.

---

## Step 9 — Permission UX: Don't Get Stuck on "Loading" ⚠️ PITFALL #6

When the user grants permission, **close the prompt UI immediately and run
`pushManager.subscribe()` in the background**. Don't await the whole chain
before hiding the button — if `serviceWorker.ready` or `subscribe()` hangs,
the button is stuck on "Enabling…" forever.

```tsx
const handleEnable = async () => {
  setLoading(true)
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') { /* error toast */; setLoading(false); return }

  // Close UI now — don't await subscription
  setOpen(false); setLoading(false)

  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    })
    await syncSubscriptionToServer(sub)
    toast.success('Notifications enabled')
  } catch {
    toast.error('Failed to register for notifications')
  }
}
```

---

## Step 10 — Self-Heal: Always Sync the Subscription to Server

If a previous subscribe call succeeded in the browser but **failed to persist
to your DB** (e.g., 400 from schema mismatch, 500 from upsert error), the
browser holds a `PushSubscription` but your DB has no row. The user looks
"enabled" client-side but no pushes ever arrive.

Whenever a settings/profile page that knows about push loads, do a full sync:

```ts
const refresh = async () => {
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()

  // Self-heal: permission granted but no sub → subscribe.
  if (!sub && Notification.permission === 'granted') {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
    })
  }

  // Always re-sync to server, even if sub already existed locally.
  if (sub) await syncSubscriptionToServer(sub)

  setEnabled(!!sub)
}

refresh()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh()
})
window.addEventListener('focus', refresh)
```

This is what saves you from "permission says granted but DB is empty"
during incremental bugfixes — the next page load heals it.

---

## Step 11 — Permission Request (iOS Requirements) ⚠️ PITFALL #7

iOS Web Push requirements:
- **iOS 16.4+** only.
- App must be **added to Home Screen** (standalone PWA). Push does NOT work
  from a Safari browser tab.
- Permission must be requested from a **user gesture** (button click) — NOT
  from `useEffect` on mount. Auto-prompting from mount silently fails.

A centered modal/dialog on home page with a clear "Enable notifications"
button is the recommended pattern. Track dismissal in localStorage so it
doesn't re-prompt forever.

---

## Debug Checklist

When push is sent but notification doesn't appear, walk this list **in order**:

| # | Check | How |
|---|-------|-----|
| 1 | Is `/sw.js` served? | `curl -I https://yourapp.com/sw.js` — must be 200. 404 = SW not emitted (Turbopack/next-pwa mismatch). |
| 2 | If next-pwa path, does worker-*.js load? | `curl -I https://yourapp.com/worker-HASH.js` — 307 = middleware blocking. |
| 3 | Is the SW registered on the client? | DevTools → Application → Service Workers. iOS: Safari → Develop → [device] → Service Workers. |
| 4 | Did the subscribe API succeed? | Vercel logs or DB query. Log all 4xx/5xx server-side. |
| 5 | Is the row in `push_subscriptions`? | `select count(*) from push_subscriptions where user_id = '<id>'` |
| 6 | Did web-push return success? | API response `{ sent: N }`. 410 means subscription is stale. |
| 7 | Are notifications enabled at OS level? | iOS Settings → Notifications → [Your App]. |

Run from server side (Node REPL with service role key) to verify DB state:

```js
const { data } = await sb.from('push_subscriptions').select('*');
console.log(data.length); // 0 = nothing saved, the issue is upstream
```

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `/sw.js` 404 in prod | Using next-pwa on Next 16 + Turbopack (no-op) | Switch to static `public/sw.js` + manual register |
| `importScripts` silent fail | `worker-*.js` blocked by auth middleware | Add `/worker-` to public prefixes |
| `customWorkerSrc` ignored | Using filename instead of directory | Set to `"worker"` (directory with `index.js`) |
| `showNotification` silent fail | Wrong icon path | Verify exact filenames in `public/icons/` |
| Subscribe POST 400 / 0 rows in DB | Client/server payload shape mismatch | Pick ONE shape, match on both sides |
| Subscribe POST 500 silently | `upsert(onConflict:'endpoint')` with no UNIQUE | Use delete-then-insert, or add UNIQUE constraint |
| iOS: permission granted, sub never created | `applicationServerKey` is a base64 string | Convert with `urlBase64ToUint8Array` |
| TS build error: `Uint8Array<ArrayBufferLike>` not assignable | Return type too wide for Next 16 lib types | Helper returns `Uint8Array<ArrayBuffer>` (allocate `new ArrayBuffer`) |
| Permission dialog stuck on "Enabling…" | Awaiting full subscribe chain before closing UI | Close UI as soon as permission granted; subscribe in background |
| Profile says "off" though user enabled push | Browser has sub but DB row missing | Always sync existing sub to server on profile load (self-heal) |
| Permission never asked on iOS | Called from `useEffect`, not user gesture | Trigger only from a click handler |
