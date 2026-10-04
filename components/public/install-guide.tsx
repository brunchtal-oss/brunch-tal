"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import { InlineNotice } from "@/components/shared/inline-notice"
import { Button } from "@/components/ui/button"
import { pwaCopy } from "@/lib/copy/pwa"

const copy = pwaCopy.install

// Chrome's install event (not in the DOM typings).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const STANDALONE = "(display-mode: standalone)"

function subscribeStandalone(onChange: () => void) {
  const query = window.matchMedia(STANDALONE)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function isStandalone() {
  // navigator.standalone: an app opened from the iPhone home screen.
  return (
    window.matchMedia(STANDALONE).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// /install (story 5.9, EXPERIENCE › install guide): a card per platform with
// numbered steps. Android shows the install button only after Chrome's
// beforeinstallprompt; without it, the steps. Opened from the installed app,
// one line says it is already installed.
export function InstallGuide() {
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    isStandalone,
    () => false
  )
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [justInstalled, setJustInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setPrompt(event as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setPrompt(null)
      setJustInstalled(true)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    // The event works once, whatever she chose.
    const { outcome } = await prompt.userChoice
    setPrompt(null)
    if (outcome === "accepted") setJustInstalled(true)
  }

  return (
    <InstallGuideView
      installed={standalone || justInstalled}
      canPrompt={prompt !== null}
      onInstall={install}
    />
  )
}

export function InstallGuideView({
  installed,
  canPrompt,
  onInstall,
}: {
  installed: boolean
  canPrompt: boolean
  onInstall?: () => void
}) {
  if (installed) {
    return <InlineNotice tone="success">{copy.installed}</InlineNotice>
  }
  return (
    <div className="flex flex-col gap-4">
      <PlatformCard title={copy.android.title}>
        {canPrompt ? (
          <Button
            type="button"
            size="lg"
            className="h-12 w-full px-[22px] text-base"
            onClick={onInstall}
          >
            {copy.android.button}
          </Button>
        ) : (
          <Steps steps={copy.android.steps} />
        )}
      </PlatformCard>
      <PlatformCard title={copy.iphone.title}>
        <InlineNotice tone="info">{copy.iphone.note}</InlineNotice>
        <Steps steps={copy.iphone.steps} />
      </PlatformCard>
    </div>
  )
}

// DESIGN › card: card surface, 1px border, the platform's name as its title.
function PlatformCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card px-4 pt-4 pb-2"
    >
      <h2 className="font-heading text-xl leading-[1.3] font-normal">
        {title}
      </h2>
      {children}
    </section>
  )
}

// The steps are a real sequence: numbered like the public steps section
// (quiet numeral column, a rule between steps).
function Steps({ steps }: { steps: readonly string[] }) {
  return (
    <ol data-steps="">
      {steps.map((step, index) => (
        <li
          key={step}
          className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 border-t border-border py-3.5"
        >
          <span
            aria-hidden
            className="font-heading text-[22px] leading-[1.1] font-light text-muted-foreground tabular-nums"
          >
            {index + 1}
          </span>
          <span className="text-base leading-normal">{step}</span>
        </li>
      ))}
    </ol>
  )
}
