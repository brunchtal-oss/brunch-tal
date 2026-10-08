import { describe, expect, it } from "vitest"

import { buttonClass } from "./button-class"

describe("buttonClass", () => {
  it("the caller's border and height win over the variant's", () => {
    const classes = buttonClass({
      variant: "outline",
      size: "lg",
      className: "h-12 border border-foreground bg-transparent",
    }).split(" ")
    expect(classes).toContain("border-foreground")
    expect(classes).not.toContain("border-transparent")
    expect(classes).not.toContain("border-border")
    expect(classes).toContain("h-12")
    expect(classes).not.toContain("h-9")
    expect(classes).not.toContain("bg-background")
  })
})
