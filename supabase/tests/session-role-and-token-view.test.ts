// Story 1.7: get_my_session_role (invoker, authenticated) and the public
// state of a link in token_view (service role). Fictitious profiles only, no
// Auth users; everything is rolled back.

import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  asAuthenticated,
  asServiceRole,
  inRollback,
  testName,
  type Db,
} from "./support/db"

// As the owner. `anonymized` marks a customer whose details were removed;
// `activated: false` leaves activated_at null.
async function createProfile(
  db: Db,
  label: string,
  { anonymized = false, activated = true } = {}
): Promise<string> {
  const id = randomUUID()
  await db.query(
    `insert into public.profiles (id, full_name, activated_at, anonymized_at)
     values ($1, $2, case when $4::boolean then now() end,
             case when $3::boolean then now() end)`,
    [id, testName(label), anonymized, activated]
  )
  return id
}

async function sessionRole(db: Db, userId: string): Promise<string> {
  await asAuthenticated(db, userId)
  const { rows } = await db.query("select public.get_my_session_role() as v")
  return rows[0].v
}

describe("get_my_session_role", () => {
  it("is customer for an activated profile", async () => {
    await inRollback(async (db) => {
      const id = await createProfile(db, "role_customer")
      expect(await sessionRole(db, id)).toBe("customer")
    })
  })

  it("is admin for a user in admin_roles", async () => {
    await inRollback(async (db) => {
      const id = randomUUID()
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        id,
      ])
      expect(await sessionRole(db, id)).toBe("admin")
    })
  })

  it("is admin for an admin who also has an activated profile", async () => {
    await inRollback(async (db) => {
      const id = await createProfile(db, "role_admin_customer")
      await db.query("insert into public.admin_roles (user_id) values ($1)", [
        id,
      ])
      expect(await sessionRole(db, id)).toBe("admin")
    })
  })

  it("is none for a profile that is not activated", async () => {
    await inRollback(async (db) => {
      const id = await createProfile(db, "role_not_activated", {
        activated: false,
      })
      expect(await sessionRole(db, id)).toBe("none")
    })
  })

  it("is none for a signed-in user without a profile", async () => {
    await inRollback(async (db) => {
      expect(await sessionRole(db, randomUUID())).toBe("none")
    })
  })

  it("is none for an anonymized profile", async () => {
    await inRollback(async (db) => {
      const id = await createProfile(db, "role_anonymized", {
        anonymized: true,
      })
      expect(await sessionRole(db, id)).toBe("none")
    })
  })
})

describe("token_view state_public", () => {
  type Issued = { token_id: string; token: string }

  async function issue(db: Db, userId: string): Promise<Issued> {
    const { rows } = await db.query(
      "select public.issue_reset_token($1) as v",
      [userId]
    )
    return rows[0].v
  }

  async function view(db: Db, token: string): Promise<Record<string, unknown>> {
    const { rows } = await db.query("select public.token_view($1) as v", [
      token,
    ])
    return rows[0].v
  }

  it("is active for a live link", async () => {
    await inRollback(async (db) => {
      const userId = await createProfile(db, "view_active")
      await asServiceRole(db)
      const { token } = await issue(db, userId)

      expect(await view(db, token)).toMatchObject({
        state_public: "active",
        purpose: "reset",
      })
    })
  })

  it("is used for a consumed link", async () => {
    await inRollback(async (db) => {
      const userId = await createProfile(db, "view_used")
      await asServiceRole(db)
      const { token } = await issue(db, userId)
      await db.query("select public.reset_complete($1, $2)", [
        token,
        randomUUID(),
      ])

      expect(await view(db, token)).toMatchObject({ state_public: "used" })
    })
  })

  it("is expired for a link revoked by a replacement", async () => {
    await inRollback(async (db) => {
      const userId = await createProfile(db, "view_revoked")
      await asServiceRole(db)
      const { token } = await issue(db, userId)
      await issue(db, userId)

      expect(await view(db, token)).toMatchObject({
        state_public: "expired",
        expires_on: null,
      })
    })
  })

  it("is expired once the link's expires_at has passed", async () => {
    await inRollback(async (db) => {
      const userId = await createProfile(db, "view_expired")
      await asServiceRole(db)
      const { token_id: tokenId, token } = await issue(db, userId)
      await db.query("reset role")
      await db.query(
        "update public.activation_tokens set expires_at = now() - interval '1 second' where id = $1",
        [tokenId]
      )
      await asServiceRole(db)

      expect(await view(db, token)).toMatchObject({
        state_public: "expired",
        expires_on: null,
      })
    })
  })

  it("is not_found for an unknown token", async () => {
    await inRollback(async (db) => {
      await asServiceRole(db)
      expect(await view(db, "x".repeat(43))).toMatchObject({
        state_public: "not_found",
      })
    })
  })
})
