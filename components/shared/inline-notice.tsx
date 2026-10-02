import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

const TONES = {
  info: { className: "bg-pending-tint text-pending", Icon: InfoIcon },
  warning: {
    className: "bg-warning-tint text-warning",
    Icon: TriangleAlertIcon,
  },
  error: { className: "bg-error-tint text-error", Icon: CircleAlertIcon },
  success: {
    className: "bg-success-tint text-success",
    Icon: CircleCheckIcon,
  },
} as const

// DESIGN.md › inline-notice: status tint with text in the status colour,
// decorative icon, 8px corners. Fixed shape: one-line reason, then actions.
export function InlineNotice({
  tone,
  children,
  actions,
  className,
}: {
  tone: keyof typeof TONES
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  const { className: toneClass, Icon } = TONES[tone]
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-3 rounded-xl px-4 py-3 text-[15px] leading-normal",
        toneClass,
        className
      )}
    >
      <p className="flex items-start gap-2">
        <Icon
          aria-hidden
          strokeWidth={1.5}
          className="mt-0.5 size-5 shrink-0"
        />
        <span>{children}</span>
      </p>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  )
}
