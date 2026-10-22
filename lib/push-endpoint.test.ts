import { describe, expect, it } from "vitest"

import { isAllowedPushEndpoint } from "./push-endpoint"

describe("isAllowedPushEndpoint (story 5.20)", () => {
  it("accepts the known push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc:APA91b-x_y",
      "https://web.push.apple.com/QGx-1_2",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2b",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB",
      "https://fcm.googleapis.com:443/fcm/send/abc",
    ]) {
      expect(isAllowedPushEndpoint(endpoint), endpoint).toBe(true)
    }
  })

  it("refuses another host, userinfo, a port, uppercase and look-alikes", () => {
    for (const endpoint of [
      "https://evil.example.com/fcm/send/abc",
      "https://fcm.googleapis.com@evil.example.com/x",
      "https://user@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://FCM.googleapis.com/x",
      "https://fcm.googleapis.com.evil.com/x",
      "https://evilpush.apple.com/x",
      "https://.push.apple.com/x",
      "https://push.apple.com/x",
      "https://x.notify.windows.com.evil.com/x",
      "http://fcm.googleapis.com/x",
      "https://fcm.googleapis.com\\@evil.com/x",
      "https://fcm.googleapis.com/a b",
      `https://fcm.googleapis.com/${"a".repeat(1000)}`,
      "",
      null,
    ]) {
      expect(isAllowedPushEndpoint(endpoint), String(endpoint)).toBe(false)
    }
  })
})
