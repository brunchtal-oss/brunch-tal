// accessible-web-widget@1.6.2 ships no types for its main entry (story
// 5.25, lib/accessibility-widget.ts). Importing it starts the widget from
// window.AccessibleWebWidgetOptions.

declare module "accessible-web-widget" {
  const AccessibleWebWidget: {
    instance?: import("@/lib/accessibility-widget").AccessibleWebWidgetInstance
  }
  export default AccessibleWebWidget
}

interface Window {
  AccessibleWebWidget?: {
    instance?: import("@/lib/accessibility-widget").AccessibleWebWidgetInstance
  }
  AccessibleWebWidgetOptions?: Record<string, unknown>
}
