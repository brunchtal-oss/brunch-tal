"use client"

import { useState } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { authCopy } from "@/lib/copy/auth"

// Password input with a "show password" toggle (aria-pressed). Paste allowed.
export function PasswordInput(
  props: Omit<React.ComponentProps<typeof Input>, "type">
) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className="h-11 pe-11 text-base"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute end-1.5 top-1/2 -translate-y-1/2"
        aria-pressed={visible}
        aria-label={authCopy.showPassword}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </Button>
    </div>
  )
}
