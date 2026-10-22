// Story 5.22: the pure SQL builders of video-seed's direct writes (DW1–DW5)
// and of video-clear (the world set, its guards, counts and deletes). No env
// and no pg here; tested in test/video-sql.test.ts. Every id goes in as a
// validated uuid literal, every date and moment as a validated literal, so
// nothing from the database or the cast is spliced in raw.
//
// The world (no marker column, no file): the Auth users on the video domain,
// the filming admin among them, and their profiles; the rows the filming
// admin made (payments.recorded_by, customer_notes.created_by,
// audit_log.actor_id); the sessions whose create/duplicate audit row has
// that actor; everything linked to them; and the board notes whose id a
// stored admin_add_note result of the filming admin names (D10). bookings
// .booked_by is a role ('admin'), not a user, so bookings join the world
// through their customer, session or payment.

import { isDate, isMoment, isUuid } from "./video-plan.mjs"

export const DEV_ADMIN_EMAIL = "dev-admin@example.com"
export const DEV_CUSTOMER_EMAIL = "dev-customer@example.com"

// ------------------------------------------------------------- literals

export function uuidLiteral(id) {
  if (!isUuid(id)) throw new Error("unexpected id")
  return `'${id.toLowerCase()}'::uuid`
}

export function uuidArray(ids) {
  for (const id of ids) {
    if (!isUuid(id)) throw new Error("unexpected id")
  }
  return `'{${ids.map((id) => id.toLowerCase()).join(",")}}'::uuid[]`
}

export function dateLiteral(date) {
  if (!isDate(date)) throw new Error("unexpected date")
  return `date '${date}'`
}

// A local Asia/Jerusalem moment ("YYYY-MM-DD HH:MM"), never after now().
export function momentLiteral(moment) {
  if (!isMoment(moment)) throw new Error("unexpected moment")
  return `least(timestamp '${moment}' at time zone 'Asia/Jerusalem', now())`
}

function emailLiteral(email) {
  if (typeof email !== "string" || !/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(email)) {
    throw new Error("unexpected email")
  }
  return `'${email}'`
}

function domainPattern(domain) {
  if (typeof domain !== "string" || !/^[a-z0-9.-]+$/.test(domain)) {
    throw new Error("unexpected domain")
  }
  return `'%@${domain}'`
}

const SLOT = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/

function values(rows, columns) {
  return `(values ${rows.map((row) => `(${row.join(", ")})`).join(", ")}) as v(${columns.join(", ")})`
}

// --------------------------------------------------------------- DW1

/** DW1: the filming admin's admin_roles row (idempotent). */
export function adminRoleSql(userId) {
  return `insert into public.admin_roles (user_id) values (${uuidLiteral(userId)}) on conflict (user_id) do nothing;`
}

// ----------------------------------------------------------- DW2–DW5

/**
 * The statements of the direct-writes transaction (DW2–DW5), in order; the
 * caller wraps them in begin/commit. Every statement is safe to run again
 * (a shifted session is matched by its temporary date, the rest sets
 * absolute values), so a run that died after this transaction and before
 * the anchor was marked complete replays it without harm.
 *
 * @param {{
 *   filmingAdminId: string,
 *   history: { eventId: string, realDate: string, tempDate: string }[],
 *   historyBookings: { bookingId: string, at: string }[],
 *   payments: { paymentId: string, at: string, boundAt: string, notifyAt: string }[],
 *   joins: { customerId: string, paymentId: string, at: string }[],
 *   events: { eventId: string, createdAt: string }[],
 *   expiredLinks: string[],
 *   marketingSlot: string | null,
 * }} input
 * @returns {string[]}
 */
export function directWritesSql(input) {
  const {
    filmingAdminId,
    history,
    historyBookings,
    payments,
    joins,
    events,
    expiredLinks,
    marketingSlot,
  } = input
  const sql = []
  const historyIds = history.map((h) => h.eventId)
  const historyArray = uuidArray(historyIds)

  // DW2: the history sessions move back by whole weeks (same local time,
  // so DST-safe); the triggers recompute the registration close and the
  // revision. Their pinned purchases move with them (the expiry approval
  // would compute, paid_on being before the real day).
  for (const h of history) {
    const id = uuidLiteral(h.eventId)
    const real = dateLiteral(h.realDate)
    const temp = dateLiteral(h.tempDate)
    sql.push(
      `update public.events e set starts_at = private.local_instant(${real}, (e.starts_at at time zone 'Asia/Jerusalem')::time), ends_at = private.local_instant(${real}, (e.ends_at at time zone 'Asia/Jerusalem')::time) where e.id = ${id} and (e.starts_at at time zone 'Asia/Jerusalem')::date = ${temp};`,
      `update public.entitlements en set expires_on = ${real} where en.pinned_event_id = ${id} and en.expires_on = ${temp};`
    )
  }
  // Their notifications name the temporary date: they go, with their jobs.
  if (historyIds.length > 0) {
    const named = `(exists (select 1 from public.bookings b where b.event_id = any(${historyArray}) and position(b.id::text in n.dedupe_key) > 0) or exists (select 1 from public.entitlements en where en.pinned_event_id = any(${historyArray}) and position(en.payment_id::text in n.dedupe_key) > 0) or exists (select 1 from unnest(${historyArray}) h(id) where position(h.id::text in n.dedupe_key) > 0))`
    sql.push(
      `delete from public.notification_deliveries d using public.notification_jobs j, public.notifications n where d.job_id = j.id and j.notification_id = n.id and ${named};`,
      `delete from public.notification_jobs j using public.notifications n where j.notification_id = n.id and ${named};`,
      `delete from public.notifications n where ${named};`
    )
  }
  // As cron does: reservations of ended sessions become use. The job only
  // warns per failed session, so every history session must now be
  // completed, or the transaction rolls back.
  sql.push("select private.job_complete_events();")
  if (historyIds.length > 0) {
    sql.push(
      `do $check$ begin if exists (select 1 from public.events e where e.id = any(${historyArray}) and e.status <> 'completed') then raise exception 'history sessions not completed'; end if; end $check$;`
    )
  }

  // DW3: backdating (D5). Purchases, their entitlements and grants.
  if (payments.length > 0) {
    const pv = values(
      payments.map((p) => [
        uuidLiteral(p.paymentId),
        momentLiteral(p.at),
        momentLiteral(p.boundAt),
        momentLiteral(p.notifyAt),
      ]),
      ["id", "at", "bound_at", "notify_at"]
    )
    sql.push(
      `update public.payments p set created_at = v.at from ${pv} where p.id = v.id;`,
      `update public.entitlements en set created_at = v.at, bound_at = case when en.bound_at is null then null else v.bound_at end from ${pv} where en.payment_id = v.id;`,
      `update public.audit_log a set created_at = v.at from ${pv} where a.action in ('approve_payment', 'admin_approve_payment') and a.entity_type in ('payments', 'entitlements', 'activation_tokens') and (a.entity_id = v.id or a.entity_id in (select en.id from public.entitlements en where en.payment_id = v.id) or a.entity_id in (select t.id from public.activation_tokens t where t.payment_id = v.id));`,
      `update public.notifications n set created_at = v.notify_at from ${pv} where position(v.id::text in n.dedupe_key) > 0;`
    )
  }
  // Joins: the profile, its consents, babies, the consumed link.
  if (joins.length > 0) {
    const jv = values(
      joins.map((j) => [
        uuidLiteral(j.customerId),
        uuidLiteral(j.paymentId),
        momentLiteral(j.at),
      ]),
      ["customer_id", "payment_id", "at"]
    )
    sql.push(
      `update public.profiles p set created_at = v.at, activated_at = case when p.activated_at is null then null else v.at end, privacy_consent_at = case when p.privacy_consent_at is null then null else v.at end, photo_consent_at = case when p.photo_consent_at is null then null else v.at end, personal_photo_consent_at = case when p.personal_photo_consent_at is null then null else v.at end from ${jv} where p.id = v.customer_id;`,
      `update public.babies b set created_at = v.at from ${jv} where b.customer_id = v.customer_id;`,
      `update public.activation_tokens t set created_at = least(t.created_at, (select p.created_at from public.payments p where p.id = v.payment_id)), claiming_at = case when t.claiming_at is null then null else v.at end, consumed_at = v.at from ${jv} where t.payment_id = v.payment_id and t.state = 'consumed';`,
      `update public.audit_log a set created_at = v.at from ${jv} where (a.action in ('join_complete', 'bind_purchase') and a.customer_id = v.customer_id) or (a.action in ('join_begin', 'join_complete') and a.entity_type = 'activation_tokens' and a.entity_id in (select t.id from public.activation_tokens t where t.payment_id = v.payment_id));`
    )
  }
  // History bookings: between the purchase and the session.
  if (historyBookings.length > 0) {
    const bv = values(
      historyBookings.map((b) => [uuidLiteral(b.bookingId), momentLiteral(b.at)]),
      ["id", "at"]
    )
    sql.push(
      `update public.bookings b set created_at = v.at, confirmed_at = v.at from ${bv} where b.id = v.id;`,
      `update public.booking_allocations ba set created_at = v.at from ${bv} where ba.booking_id = v.id;`,
      `update public.audit_log a set created_at = v.at from ${bv} where a.entity_type = 'bookings' and a.entity_id = v.id and a.action in ('approve_payment', 'admin_approve_payment', 'admin_book_customer');`
    )
  }
  // Sessions: their creation, and its audit row.
  if (events.length > 0) {
    const ev = values(
      events.map((e) => [uuidLiteral(e.eventId), momentLiteral(e.createdAt)]),
      ["id", "at"]
    )
    sql.push(
      `update public.events e set created_at = v.at from ${ev} where e.id = v.id;`,
      `update public.audit_log a set created_at = v.at from ${ev} where a.action in ('admin_create_event', 'admin_duplicate_event') and a.entity_id = v.id;`
    )
  }
  if (historyIds.length > 0) {
    sql.push(
      `update public.audit_log a set created_at = e.ends_at from public.events e where a.action = 'complete_event' and a.event_id = e.id and e.id = any(${historyArray});`
    )
  }
  // entitlement_movements is append-only (a trigger); off for these updates
  // only.
  const movementUpdates = []
  if (payments.length > 0) {
    const pv = values(
      payments.map((p) => [uuidLiteral(p.paymentId), momentLiteral(p.at)]),
      ["id", "at"]
    )
    movementUpdates.push(
      `update public.entitlement_movements m set created_at = v.at from ${pv}, public.entitlements en where en.payment_id = v.id and m.entitlement_id = en.id and m.action = 'grant';`
    )
  }
  if (historyBookings.length > 0) {
    const bv = values(
      historyBookings.map((b) => [uuidLiteral(b.bookingId), momentLiteral(b.at)]),
      ["id", "at"]
    )
    movementUpdates.push(
      `update public.entitlement_movements m set created_at = v.at from ${bv} where m.booking_id = v.id and m.action = 'reserve';`
    )
  }
  if (historyIds.length > 0) {
    movementUpdates.push(
      `update public.entitlement_movements m set created_at = e.ends_at from public.bookings b, public.events e where m.booking_id = b.id and b.event_id = e.id and e.id = any(${historyArray}) and m.action = 'use';`
    )
  }
  if (movementUpdates.length > 0) {
    sql.push(
      "set local session_replication_role = replica;",
      ...movementUpdates,
      "set local session_replication_role = origin;"
    )
  }

  // DW4: the expired link (48 hours after its purchase, in the past).
  for (const paymentId of expiredLinks) {
    sql.push(
      `update public.activation_tokens t set created_at = p.created_at, expires_at = least(p.created_at + interval '48 hours', now() - interval '1 minute') from public.payments p where t.payment_id = p.id and p.id = ${uuidLiteral(paymentId)} and t.state = 'pending';`
    )
  }

  // DW5: the jobs, once, as cron runs them; and today's marketing reminder
  // for the filming admin through the job's own writer (D9).
  sql.push(
    "select private.job_expiry_alerts();",
    "select private.job_refresh_credit_options();"
  )
  if (marketingSlot !== null) {
    if (typeof marketingSlot !== "string" || !SLOT.test(marketingSlot)) {
      throw new Error("unexpected slot")
    }
    sql.push(
      `select private.enqueue_notification(${uuidLiteral(filmingAdminId)}, 'marketing_reminder', '${marketingSlot}', null, '/admin', t.body) from (select r.body from public.marketing_reminder_texts r where r.active order by r.last_sent_at nulls first, r.sort_order, r.id limit 1) t;`
    )
  }
  return sql
}

// ------------------------------------------------------------ the world

// The temp tables of the world set, in dependency order (one transaction).
// Their names are the keys of COUNT_TABLES and DELETE_PLAN.
/**
 * @param {{ adminEmail: string, domain: string }} input
 * @returns {string[]}
 */
export function worldSetSql({ adminEmail, domain }) {
  const admin = emailLiteral(adminEmail)
  const like = domainPattern(domain)
  const t = (name, select) =>
    `create temp table ${name} on commit drop as ${select};`
  return [
    t("w_admin", `select u.id from auth.users u where lower(u.email) = ${admin}`),
    t("w_users", `select u.id from auth.users u where lower(u.email) like ${like}`),
    t(
      "w_profiles",
      `select p.id from public.profiles p where p.id in (select id from w_users) union select pay.customer_id from public.payments pay where pay.recorded_by in (select id from w_admin) and pay.customer_id is not null union select cn.customer_id from public.customer_notes cn where cn.created_by in (select id from w_admin)`
    ),
    t("w_people", `select id from w_users union select id from w_profiles`),
    t(
      "w_events",
      `select distinct a.entity_id as id from public.audit_log a join public.events e on e.id = a.entity_id where a.actor_id in (select id from w_admin) and a.entity_type = 'events' and a.action in ('admin_create_event', 'admin_duplicate_event')`
    ),
    t(
      "w_payments",
      `select p.id from public.payments p where p.recorded_by in (select id from w_admin) or p.customer_id in (select id from w_profiles) union select b.payment_id from public.bookings b where b.event_id in (select id from w_events) and b.payment_id is not null union select en.payment_id from public.entitlements en where en.pinned_event_id in (select id from w_events)`
    ),
    t(
      "w_bookings",
      `select b.id from public.bookings b where b.customer_id in (select id from w_profiles) or b.event_id in (select id from w_events) or b.payment_id in (select id from w_payments)`
    ),
    t(
      "w_entitlements",
      `select en.id from public.entitlements en where en.customer_id in (select id from w_profiles) or en.payment_id in (select id from w_payments) or en.pinned_event_id in (select id from w_events)`
    ),
    t(
      "w_credits",
      `select c.id from public.cancellation_credits c where c.customer_id in (select id from w_profiles) or c.origin_booking_id in (select id from w_bookings) or c.source_entitlement_id in (select id from w_entitlements)`
    ),
    t(
      "w_options",
      `select o.id from public.credit_options o where o.credit_id in (select id from w_credits) or o.event_id in (select id from w_events)`
    ),
    t(
      "w_refunds",
      `select r.id from public.refund_requests r where r.credit_id in (select id from w_credits) or r.payment_id in (select id from w_payments) or r.booking_id in (select id from w_bookings) or r.customer_id in (select id from w_profiles)`
    ),
    t(
      "w_allocations",
      `select ba.id from public.booking_allocations ba where ba.booking_id in (select id from w_bookings) or ba.entitlement_id in (select id from w_entitlements) or ba.credit_id in (select id from w_credits)`
    ),
    t(
      "w_movements",
      `select m.id from public.entitlement_movements m where m.entitlement_id in (select id from w_entitlements) or m.booking_id in (select id from w_bookings)`
    ),
    t(
      "w_corrections",
      `select c.id from public.entitlement_corrections c where c.entitlement_id in (select id from w_entitlements) or c.related_event_id in (select id from w_events) or c.actor_id in (select id from w_admin)`
    ),
    t(
      "w_correction_bookings",
      `select cb.correction_id, cb.booking_id from public.entitlement_correction_bookings cb where cb.correction_id in (select id from w_corrections) or cb.booking_id in (select id from w_bookings)`
    ),
    t(
      "w_waitlist",
      `select w.id from public.waitlist_entries w where w.customer_id in (select id from w_profiles) or w.event_id in (select id from w_events)`
    ),
    t(
      "w_tokens",
      `select tk.id from public.activation_tokens tk where tk.payment_id in (select id from w_payments) or tk.customer_id in (select id from w_profiles) or tk.bound_user_id in (select id from w_people) or tk.pending_user_id in (select id from w_people)`
    ),
    t("w_sheets", `select s.id from public.work_sheets s where s.event_id in (select id from w_events)`),
    t("w_dishes", `select d.id from public.work_dishes d where d.sheet_id in (select id from w_sheets)`),
    t("w_tasks", `select tt.id from public.work_tasks tt where tt.dish_id in (select id from w_dishes)`),
    t("w_shopping", `select i.id from public.shopping_items i where i.sheet_id in (select id from w_sheets)`),
    t(
      "w_event_products",
      `select ep.event_id, ep.product_id from public.event_products ep where ep.event_id in (select id from w_events)`
    ),
    t("w_babies", `select b.id from public.babies b where b.customer_id in (select id from w_profiles)`),
    t(
      "w_customer_notes",
      `select cn.id from public.customer_notes cn where cn.customer_id in (select id from w_profiles) or cn.created_by in (select id from w_admin)`
    ),
    t(
      "w_subscriptions",
      `select ps.id from public.push_subscriptions ps where ps.user_id in (select id from w_people)`
    ),
    t(
      "w_ids",
      `select id::text as id from w_people union select id::text from w_payments union select id::text from w_entitlements union select id::text from w_bookings union select id::text from w_events union select id::text from w_tokens union select id::text from w_credits union select id::text from w_refunds union select id::text from w_corrections`
    ),
    t(
      "w_notifications",
      `select n.id from public.notifications n where n.recipient_id in (select id from w_people) or exists (select 1 from w_ids i where position(i.id in n.dedupe_key) > 0)`
    ),
    t(
      "w_jobs",
      `select j.id from public.notification_jobs j where j.notification_id in (select id from w_notifications)`
    ),
    t(
      "w_notes",
      `select n.id from public.notes n where n.id::text in (select r.result ->> 'note_id' from private.idempotency_results r where r.rpc = 'admin_add_note' and r.actor_scope in (select id::text from w_admin) and r.result is not null)`
    ),
    t(
      "w_audit",
      `select a.id from public.audit_log a where a.actor_id in (select id from w_people) or a.customer_id in (select id from w_profiles) or a.event_id in (select id from w_events) or a.entity_id::text in (select id from w_ids) or a.entity_id in (select id from w_notes) or a.entity_id in (select id from w_customer_notes)`
    ),
    t(
      "w_idempotency",
      `select r.actor_scope, r.rpc, r.key from private.idempotency_results r where r.actor_scope in (select id::text from w_people) or r.actor_scope in (select 'token:' || id::text from w_tokens)`
    ),
  ]
}

// The tables counted (and deleted), in delete order: [label, count query].
export const COUNT_TABLES = [
  ["notification_deliveries", "select count(*) from public.notification_deliveries d where d.job_id in (select id from w_jobs)"],
  ["notification_jobs", "select count(*) from w_jobs"],
  ["notifications", "select count(*) from w_notifications"],
  ["push_subscriptions", "select count(*) from w_subscriptions"],
  ["refund_requests", "select count(*) from w_refunds"],
  ["credit_options", "select count(*) from w_options"],
  ["entitlement_correction_bookings", "select count(*) from w_correction_bookings"],
  ["entitlement_movements", "select count(*) from w_movements"],
  ["booking_allocations", "select count(*) from w_allocations"],
  ["entitlement_corrections", "select count(*) from w_corrections"],
  ["cancellation_credits", "select count(*) from w_credits"],
  ["waitlist_entries", "select count(*) from w_waitlist"],
  ["bookings", "select count(*) from w_bookings"],
  ["entitlements", "select count(*) from w_entitlements"],
  ["activation_tokens", "select count(*) from w_tokens"],
  ["payments", "select count(*) from w_payments"],
  ["shopping_items", "select count(*) from w_shopping"],
  ["work_tasks", "select count(*) from w_tasks"],
  ["work_dishes", "select count(*) from w_dishes"],
  ["work_sheets", "select count(*) from w_sheets"],
  ["event_products", "select count(*) from w_event_products"],
  ["audit_log", "select count(*) from w_audit"],
  ["events", "select count(*) from w_events"],
  ["customer_notes", "select count(*) from w_customer_notes"],
  ["babies", "select count(*) from w_babies"],
  ["notes", "select count(*) from w_notes"],
  ["idempotency_results", "select count(*) from w_idempotency"],
  ["profiles", "select count(*) from w_profiles"],
  ["admin_roles", "select count(*) from public.admin_roles r where r.user_id in (select id from w_admin)"],
  ["auth.users", "select count(*) from w_users"],
]

/** One row, one column "counts": { table: n } in delete order. */
export function countsSql() {
  return `select json_build_object(${COUNT_TABLES.map(
    ([label, query]) => `'${label}', (${query})`
  ).join(", ")}) as counts;`
}

/**
 * The rows that stop the clear (reason, id), [] when it may go on:
 * dev_account (the set touches dev-admin or dev-customer), test_row (a
 * test_ row), foreign_booking / foreign_waitlist (a row of a non-world
 * customer in a world session), foreign_credit_option (an option of a
 * non-world credit on a world session), foreign_correction (a correction by
 * the filming admin, or on a world session, of a non-world entitlement),
 * foreign_customer (a profile of the set that is not anonymized and has no
 * Auth user on the domain, e.g. a live join with another email or a note on
 * a non-world customer), foreign_join_user (a link of the set whose pending
 * or bound Auth user is not on the domain: deleting the link would orphan
 * that user). w_notes holds only notes traced to the filming admin by
 * construction (D10), so the board needs no guard here.
 *
 * @param {{ domain: string }} input
 */
export function guardSql({ domain }) {
  const like = domainPattern(domain)
  const devEmails = `(${emailLiteral(DEV_ADMIN_EMAIL)}, ${emailLiteral(DEV_CUSTOMER_EMAIL)})`
  return `select distinct g.reason, g.id from (${[
    `select 'dev_account' as reason, p.id::text as id from w_people p join auth.users u on u.id = p.id where lower(u.email) in ${devEmails}`,
    `select 'test_row', p.id::text from public.profiles p where p.id in (select id from w_profiles) and p.full_name ilike 'test\\_%'`,
    `select 'test_row', u.id::text from auth.users u where u.id in (select id from w_users) and u.email ilike 'test\\_%'`,
    `select 'test_row', cn.id::text from public.customer_notes cn where cn.id in (select id from w_customer_notes) and cn.body ilike 'test\\_%'`,
    `select 'test_row', n.id::text from public.notes n where n.id in (select id from w_notes) and n.body ilike 'test\\_%'`,
    `select 'foreign_booking', b.id::text from public.bookings b where b.event_id in (select id from w_events) and b.customer_id is not null and b.customer_id not in (select id from w_profiles)`,
    `select 'foreign_waitlist', w.id::text from public.waitlist_entries w where w.id in (select id from w_waitlist) and w.customer_id not in (select id from w_profiles)`,
    `select 'foreign_credit_option', o.id::text from public.credit_options o where o.id in (select id from w_options) and o.credit_id not in (select id from w_credits)`,
    `select 'foreign_correction', c.id::text from public.entitlement_corrections c where c.id in (select id from w_corrections) and c.entitlement_id not in (select id from w_entitlements)`,
    `select 'foreign_customer', p.id::text from public.profiles p where p.id in (select id from w_profiles) and p.anonymized_at is null and not exists (select 1 from auth.users u where u.id = p.id and lower(u.email) like ${like})`,
    `select 'foreign_join_user', tk.id::text from public.activation_tokens tk join auth.users u on u.id in (tk.pending_user_id, tk.bound_user_id) where tk.id in (select id from w_tokens) and lower(u.email) not like ${like}`,
  ].join(" union all ")}) g order by g.reason, g.id;`
}

/**
 * The warnings of a clear (nothing stops), rows (kind, n, id, created_at,
 * excerpt): one "media" row with the count of media the filming admin
 * uploaded (they stay; the seed creates none), and one "old_note" row per
 * board note made since the filming admin exists that no stored result
 * names any more (purged after 7 days, D10; it stays), with its id, time and
 * the start of its text, so the user can tell it from her own notes.
 */
export function warningsSql() {
  return [
    "select 'media' as kind, count(*)::integer as n, null::text as id, null::timestamptz as created_at, null::text as excerpt from public.media_assets m where m.created_by in (select id from w_admin)",
    "select 'old_note', 1, n.id::text, n.created_at, left(n.body, 60) from public.notes n where n.id not in (select id from w_notes) and n.created_at >= (select min(u.created_at) from auth.users u where u.id in (select id from w_admin))",
  ].join(" union all ") + ";"
}

/**
 * The delete statements, in foreign-key order; entitlement_movements (an
 * append-only trigger) inside the only session_replication_role = replica
 * window. audit_log rows of the world are deleted, not nulled. Auth users go
 * in the same transaction.
 *
 * @returns {string[]}
 */
export function deleteSql() {
  const del = (table, temp, column = "id") =>
    `delete from ${table} where ${column} in (select id from ${temp});`
  return [
    del("public.notification_deliveries", "w_jobs", "job_id"),
    del("public.notification_jobs", "w_jobs"),
    del("public.notifications", "w_notifications"),
    del("public.push_subscriptions", "w_subscriptions"),
    del("public.refund_requests", "w_refunds"),
    del("public.credit_options", "w_options"),
    "delete from public.entitlement_correction_bookings cb using w_correction_bookings w where cb.correction_id = w.correction_id and cb.booking_id = w.booking_id;",
    "set local session_replication_role = replica;",
    del("public.entitlement_movements", "w_movements"),
    "set local session_replication_role = origin;",
    del("public.booking_allocations", "w_allocations"),
    del("public.entitlement_corrections", "w_corrections"),
    del("public.cancellation_credits", "w_credits"),
    del("public.waitlist_entries", "w_waitlist"),
    // A moved booking points at its successor (on delete restrict).
    "update public.bookings set moved_to_booking_id = null where id in (select id from w_bookings) and moved_to_booking_id is not null;",
    del("public.bookings", "w_bookings"),
    del("public.entitlements", "w_entitlements"),
    del("public.activation_tokens", "w_tokens"),
    del("public.payments", "w_payments"),
    del("public.shopping_items", "w_shopping"),
    del("public.work_tasks", "w_tasks"),
    del("public.work_dishes", "w_dishes"),
    del("public.work_sheets", "w_sheets"),
    "delete from public.event_products ep using w_event_products w where ep.event_id = w.event_id and ep.product_id = w.product_id;",
    del("public.audit_log", "w_audit"),
    del("public.events", "w_events"),
    del("public.customer_notes", "w_customer_notes"),
    del("public.babies", "w_babies"),
    del("public.notes", "w_notes"),
    "delete from private.idempotency_results r using w_idempotency w where r.actor_scope = w.actor_scope and r.rpc = w.rpc and r.key = w.key;",
    del("public.profiles", "w_profiles"),
    // No FK to auth.users: the filming admin's role would outlive it and
    // receive every admin notification.
    del("public.admin_roles", "w_admin", "user_id"),
    del("auth.users", "w_users"),
  ]
}
