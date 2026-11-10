import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

// The action state the form renders with (useActionState), per test.
const actionState = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useActionState: () => [actionState.current, vi.fn(), false],
  }
})
vi.mock("./actions", () => ({ submitJoinFillAction: vi.fn() }))
vi.mock("@/app/(auth)/join/[token]/actions", () => ({
  submitJoinAction: vi.fn(),
}))

const {
  FillJoinForm,
  FillUsed,
  copyLoginDetails,
  fillFieldMessage,
  fillOutcome,
  loginDetailsText,
  whatsappLoginHref,
} = await import("./fill-outcome")

const ENTITLEMENT = "11111111-1111-4111-8111-111111111111"
const PAYMENT = "33333333-3333-4333-8333-333333333333"
const CUSTOMER = "44444444-4444-4444-8444-444444444444"
const KEY = "22222222-2222-4222-8222-222222222222"
const PHOTO = {
  atmosphere_title: "atmosphere title",
  atmosphere_question: "q",
  atmosphere_yes: "yes label",
  atmosphere_no: "no label",
  personal_title: "personal title",
  personal_question: "personal question",
  personal_yes: "personal yes",
  personal_no: "personal no",
  note: "note",
}

function html(node: React.ReactNode) {
  return renderToStaticMarkup(<>{node}</>)
}

function replaced(outcome: ReturnType<typeof fillOutcome>) {
  if (!outcome || !("replace" in outcome)) throw new Error("no screen")
  return html(outcome.replace)
}

describe("Tal's fill (story 2.15)", () => {
  it("the shared form, with the payment hidden and no link yet", () => {
    const page = html(
      <FillJoinForm
        entitlementId={ENTITLEMENT}
        paymentId={PAYMENT}
        idempotencyKey={KEY}
        productName={null}
        amountAgorot={null}
        photoConsent={PHOTO}
        today="2026-11-09"
        privacyHref="/privacy"
      />
    )
    expect(page).toContain(`name="paymentId" value="${PAYMENT}"`)
    expect(page).not.toContain('name="token"')
    expect(page).toContain('name="password"')
    expect(page).toContain("yes label")
    expect(page).toContain('href="/privacy"')
  })

  it("joined: the password comes from the form's state, not from the result", () => {
    const state = {
      status: "fill_joined" as const,
      fullName: "Dev Fill",
      email: "dev-fill@example.com",
      customerId: CUSTOMER,
    }
    expect(JSON.stringify(state)).not.toContain("Typed-pass-1")
    const screen = replaced(
      fillOutcome(
        state,
        { password: "Typed-pass-1", phone: "050-1234567" },
        ENTITLEMENT
      )
    )
    expect(screen).toContain("החשבון נוצר")
    expect(screen).toContain("הרכישה שויכה לחשבון של Dev Fill.")
    expect(screen).toContain("dev-fill@example.com")
    expect(screen).toContain("Typed-pass-1")
    expect(screen).toContain("העתקת פרטי הכניסה")
    expect(screen).toContain("שליחה בוואטסאפ")
    expect(screen).toContain('href="https://wa.me/972501234567?text=')
    expect(screen).toContain(`href="/admin/customers/${CUSTOMER}"`)
    expect(screen).not.toContain("←")
  })

  it("the copied text: the login address first, then the details", () => {
    expect(
      loginDetailsText("a@example.com", "Pass-1234", "https://x.example")
    ).toBe(
      "*להתחברות:* https://x.example/login\n\n*פרטי הכניסה לאזור האישי:*\nמייל: a@example.com\nסיסמה: Pass-1234"
    )
  })

  it("WhatsApp: her number with the same text; none for a number it cannot open", () => {
    expect(
      whatsappLoginHref(
        "054-123 4567",
        "a@example.com",
        "Pass-1234",
        "https://x.example"
      )
    ).toBe(
      `https://wa.me/972541234567?text=${encodeURIComponent(
        loginDetailsText("a@example.com", "Pass-1234", "https://x.example")
      )}`
    )
    expect(
      whatsappLoginHref("+1 212 555 0100", "a@example.com", "P", "https://x")
    ).toBeNull()
    expect(
      replaced(
        fillOutcome(
          {
            status: "fill_joined",
            fullName: "Dev Fill",
            email: "dev-fill@example.com",
            customerId: CUSTOMER,
          },
          { password: "Typed-pass-1", phone: "+1 212 555 0100" },
          ENTITLEMENT
        )
      )
    ).not.toContain("שליחה בוואטסאפ")
  })

  it("the copy button: copied, or the manual-copy notice when the clipboard refuses", async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    await expect(
      copyLoginDetails(write, "a@example.com", "Pass-1234", "https://x.example")
    ).resolves.toBe("copied")
    expect(write).toHaveBeenCalledWith(
      loginDetailsText("a@example.com", "Pass-1234", "https://x.example")
    )
    await expect(
      copyLoginDetails(
        vi.fn().mockRejectedValue(new Error("denied")),
        "a@example.com",
        "Pass-1234",
        "https://x.example"
      )
    ).resolves.toBe("failed")
  })

  it("a bound purchase: neutral words, named with her card when known", () => {
    const plain = html(<FillUsed />)
    expect(plain).toContain(
      "הרכישה הזו כבר משויכת לחשבון של לקוחה, ולכן אין צורך למלא את הטופס."
    )
    expect(plain).not.toContain("בעצמה")
    expect(plain).toContain('href="/admin/customers"')
    const named = html(
      <FillUsed customer={{ id: CUSTOMER, name: "Dev Fill" }} />
    )
    expect(named).toContain("הרכישה הזו כבר משויכת לחשבון של Dev Fill.")
    expect(named).toContain(`href="/admin/customers/${CUSTOMER}"`)
    expect(named).toContain("לכרטיס הלקוחה")
  })

  it("used, voided and conflict replace the form; in progress is a notice", () => {
    const sent = { password: "", phone: "" }
    expect(
      replaced(fillOutcome({ status: "used" }, sent, ENTITLEMENT))
    ).toContain('href="/admin/customers"')
    expect(
      replaced(fillOutcome({ status: "voided" }, sent, ENTITLEMENT))
    ).toContain("הרכישה הזו בוטלה")
    const conflict = replaced(
      fillOutcome({ status: "conflict", reason: null }, sent, ENTITLEMENT)
    )
    expect(conflict).toContain('href="/admin/links"')
    expect(conflict).toContain(
      `href="/admin/customers/unbound/entitlements/${ENTITLEMENT}/join"`
    )
    expect(fillOutcome({ status: "in_progress" }, sent, ENTITLEMENT)).toEqual({
      notice: expect.stringContaining("15 דקות"),
    })
    expect(fillOutcome(null, sent, ENTITLEMENT)).toBeNull()
  })

  it("details taken: the email field words, with the links screen", () => {
    const words = html(fillFieldMessage("detailsTaken"))
    expect(words).toContain("המייל או הטלפון כבר רשומים בחשבון אחר")
    expect(words).toContain('href="/admin/links"')
    expect(fillFieldMessage("email")).toBeNull()
  })
})

describe("the shared form with a result of the fill (story 2.15)", () => {
  afterEach(() => {
    actionState.current = null
  })

  const form = () =>
    html(
      <FillJoinForm
        entitlementId={ENTITLEMENT}
        paymentId={PAYMENT}
        idempotencyKey={KEY}
        productName={null}
        amountAgorot={null}
        photoConsent={PHOTO}
        today="2026-11-09"
        privacyHref="/privacy"
      />
    )

  it("joined: the done screen replaces the form", () => {
    actionState.current = {
      status: "fill_joined",
      fullName: "Dev Fill",
      email: "dev-fill@example.com",
      customerId: CUSTOMER,
      token: null,
    }
    const page = form()
    expect(page).toContain("החשבון נוצר")
    expect(page).toContain("dev-fill@example.com")
    expect(page).not.toContain("<form")
    expect(page).not.toContain('name="password"')
    // The guidance lines belong to the form only.
    expect(page).not.toContain("יש למלא את הטופס עם הלקוחה")
    expect(page).not.toContain("בשליחה נוצר ללקוחה חשבון")
  })

  it("the guidance lines show with the form, also with an error, not on other screens", () => {
    expect(form()).toContain("יש למלא את הטופס עם הלקוחה")
    expect(form()).toContain("בשליחה נוצר ללקוחה חשבון")
    actionState.current = {
      status: "error",
      code: "SERVER_ERROR",
      errors: [],
      token: null,
    }
    expect(form()).toContain("יש למלא את הטופס עם הלקוחה")
    for (const status of ["used", "voided"] as const) {
      actionState.current = { status, token: null }
      const page = form()
      expect(page).not.toContain("יש למלא את הטופס עם הלקוחה")
      expect(page).not.toContain("בשליחה נוצר ללקוחה חשבון")
    }
    actionState.current = { status: "conflict", reason: null, token: null }
    expect(form()).not.toContain("יש למלא את הטופס עם הלקוחה")
  })

  it("in progress: a notice above the form, which stays", () => {
    actionState.current = { status: "in_progress", token: null }
    const page = form()
    expect(page).toContain("הטופס של הרכישה הזו כבר באמצע מילוי")
    expect(page).toContain("<form")
    expect(page.indexOf("באמצע מילוי")).toBeGreaterThan(-1)
    expect(page.indexOf("באמצע מילוי")).toBeLessThan(
      page.indexOf('name="fullName"')
    )
  })

  it("details taken: the email field error with the links screen", () => {
    actionState.current = {
      status: "error",
      code: "INVALID_INPUT",
      errors: [{ field: "email", message: "detailsTaken" }],
      token: null,
    }
    const page = form()
    const error = page.match(/<[^>]*id="email-error"[^>]*>([\s\S]*?)<\/div>/)
    expect(error?.[1]).toContain("המייל או הטלפון כבר רשומים בחשבון אחר")
    expect(error?.[1]).toContain('href="/admin/links"')
    expect(page).toContain('aria-invalid="true"')
  })
})
