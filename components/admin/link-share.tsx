"use client"

import { useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { adminCopy } from "@/lib/copy/admin"

const copy = adminCopy.payments
const BUTTON = "h-12 text-base"

// navigator.clipboard exists only in a secure context (https or localhost);
// on the dev server opened by its LAN address (http://192.168...) it is
// undefined, so a hidden textarea and execCommand("copy") copy instead.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the textarea copy
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    area.remove()
  }
}

// The WhatsApp share of a link (a message with the link only).
export function whatsappShareHref(link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(link)}`
}

// "Send on WhatsApp" and "Copy the link" for a one-time link that was just
// issued (the raw link is shown only in this answer, AD-10). Without any
// clipboard access the link is shown for a manual copy.
export function LinkShare({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const copyLink = async () => {
    if (await copyText(link)) setCopied(true)
    else setCopyFailed(true)
  }

  return (
    <>
      <a
        href={whatsappShareHref(link)}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ size: "lg", className: BUTTON })}
      >
        {copy.sendWhatsapp}
      </a>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className={BUTTON}
        onClick={copyLink}
      >
        {copy.copyLink}
      </Button>
      <p aria-live="polite" className="text-[15px] text-success">
        {copied ? copy.copied : ""}
      </p>
      {copyFailed && (
        <Input
          readOnly
          dir="ltr"
          value={link}
          aria-label={copy.copyLink}
          onFocus={(event) => event.currentTarget.select()}
          className="h-12 text-start text-base"
        />
      )}
    </>
  )
}
