"use client"

import { useEffect, useState } from "react"

import { currentEndpoint, PUSH_CHANGE_EVENT } from "@/lib/push/client"

// Inside every sign-out form (the top-bar and the sign-out button; story
// 5.8): this device's push endpoint, filled in the browser, so the sign-out
// action removes its subscription. Read again whenever push changes on this
// page (the card turned it on or off), so it is never stale. Empty when the
// device has none.
export function PushEndpointField() {
  const [endpoint, setEndpoint] = useState("")
  useEffect(() => {
    let live = true
    function read() {
      void currentEndpoint().then((value) => {
        if (live) setEndpoint(value ?? "")
      })
    }
    read()
    window.addEventListener(PUSH_CHANGE_EVENT, read)
    return () => {
      live = false
      window.removeEventListener(PUSH_CHANGE_EVENT, read)
    }
  }, [])
  return <input type="hidden" name="push_endpoint" value={endpoint} />
}
