// The notification template check of the editor (story 4.7), for an
// immediate hint only: admin_update_notification_template renders the
// template on the server with the type's allowed fields
// (private.render_notification_text) and decides. The same cases as there:
// every "{" closes with a "}" before the next "{", no "}" stands alone, and
// the name between them is one of the allowed fields.

export type TemplateCheck =
  | { ok: true }
  | { ok: false; reason: "unbalanced" }
  | { ok: false; reason: "unknown_field"; field: string }

export function checkTemplate(
  text: string,
  allowed: readonly string[]
): TemplateCheck {
  let rest = text
  for (;;) {
    const open = rest.indexOf("{")
    if (open === -1) {
      return rest.includes("}")
        ? { ok: false, reason: "unbalanced" }
        : { ok: true }
    }
    const close = rest.indexOf("}", open + 1)
    if (close === -1 || rest.slice(0, open).includes("}")) {
      return { ok: false, reason: "unbalanced" }
    }
    const field = rest.slice(open + 1, close)
    // "{}" and "{a{date}" are brace mistakes, not a field name.
    if (field === "" || field.includes("{")) {
      return { ok: false, reason: "unbalanced" }
    }
    if (!allowed.includes(field)) {
      return { ok: false, reason: "unknown_field", field }
    }
    rest = rest.slice(close + 1)
  }
}

// The text with each allowed {field} replaced by its sample value, for the
// preview. Anything else stays as written.
export function renderSample(
  text: string,
  samples: Readonly<Record<string, string>>
): string {
  return text.replace(/\{([^{}]+)\}/g, (match, name: string) =>
    Object.hasOwn(samples, name) ? samples[name] : match
  )
}
