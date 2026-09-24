---
version: alpha
name: Ziona Cafe
description: A warm, minimal café system with restrained neutrals, handwritten-like Hebrew display type, and earthy green accents.
colors:
  primary: "#000000"
  secondary: "#C9B691"
  tertiary: "#F3EEE8"
  neutral: "#FFFFFF"
  surface: "#FFFFFF"
  on-surface: "#000000"
  border: "#E5E7EB"
  muted: "#F5F1EA"
  success: "#8FA874"
  error: "#B42318"
typography:
  headline-display:
    fontFamily: Arial
    fontSize: 32px
    fontWeight: 700
    lineHeight: 38px
    letterSpacing: 0px
  headline-lg:
    fontFamily: "wfont_bd104b_25f8de09c9964b8f8deca9d8d141fc5c"
    fontSize: 27px
    fontWeight: 400
    lineHeight: 32px
    letterSpacing: 0px
  headline-md:
    fontFamily: "wfont_c9df11_c4dcbc84b3fa4c47ba0d569c9d114437"
    fontSize: 23px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px
  headline-sm:
    fontFamily: Arial
    fontSize: 20px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: 0px
  body-lg:
    fontFamily: "almoni-dl-aaa-400"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 23.8px
    letterSpacing: 0px
  body-md:
    fontFamily: "almoni-dl-aaa-400"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  body-sm:
    fontFamily: Arial
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  label-lg:
    fontFamily: Arial
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0.02em
  label-md:
    fontFamily: Arial
    fontSize: 10px
    fontWeight: 400
    lineHeight: 14px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Arial
    fontSize: 9px
    fontWeight: 400
    lineHeight: 12px
    letterSpacing: 0.02em
rounded:
  none: 0px
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
  full: 9999px
spacing:
  xs: 10px
  sm: 18px
  md: 34px
  lg: 90px
  xl: 156px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: "27px 32px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: "27px 32px"
    height: "40px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: "27px 32px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: "27px 32px"
    height: "40px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    padding: "0px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
  chip:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    padding: "6px 10px"
---

# Ziona Cafe

## Overview
Ziona Cafe feels calm, intimate, and quietly premium, with a distinctly local, hospitality-first personality. The visual language is spacious and airy, using lots of cream-white negative space to let the content and photography breathe. It balances a handcrafted Hebrew display presence with very plain functional UI, which keeps the experience approachable rather than overly polished or corporate.

## Colors
- **Primary (#000000):** The deepest ink used for core text, logo marks, and strong UI contrast. It anchors the system and gives the brand its crisp, editorial feel.
- **Secondary (#C9B691):** A muted olive-sand accent used for small highlights, active navigation, and subtle brand signaling. It reads as earthy and natural rather than decorative.
- **Tertiary (#F3EEE8):** A warm off-white used for soft button fills and gentle surface contrast. This keeps actions visible without breaking the calm palette.
- **Neutral / Surface (#FFFFFF):** Clean white used for cards, page surfaces, and open space. It supports the light, uncluttered mood.
- **On-surface (#000000):** The main text color on light backgrounds, kept pure and high-contrast for legibility.
- **Border (#E5E7EB):** A faint cool-gray border for cards and dividers when structure is needed without adding visual weight.
- **Muted (#F5F1EA):** A very light beige background tone for hover states, subtle pills, and soft UI separation.
- **Success (#8FA874):** A subdued green that matches the brand’s natural cues; use sparingly for confirmation states.
- **Error (#B42318):** A standard alert red reserved for validation and destructive states only.

## Typography
The typography mix combines pragmatic system sans-serif text with custom Hebrew display fonts, creating a clear contrast between brand expression and utility. Headlines use three main voices: a bold Arial-based display level for the strongest page titles, then two lighter custom Hebrew-style heading levels for refined editorial hierarchy. Body copy uses the Almoni family at 17px for a comfortable, readable paragraph rhythm.

Labels and navigation are intentionally small and understated, sitting at 10–12px with modest letter spacing for a tidy, restrained feel. Uppercase styling appears in English nav labels like “GIFT CARD,” while Hebrew headings stay naturally sentence-like and expressive. The overall effect is modern but unforced, with type doing most of the visual branding.

## Layout
The layout is spacious and centered, with large vertical breathing room above the hero and a wide, image-led lower section. Navigation is distributed across the top bar with generous horizontal spacing, suggesting a fluid full-width layout rather than a tight fixed grid. The spacing scale is intentionally sparse: small gaps around 10–18px for inline relationships, then larger jumps at 34px, 90px, and 156px for structural separation.

Section padding should remain generous so the site continues to feel calm and hospitality-oriented. Cards and smaller UI containers should use modest internal padding around 16px, while primary page sections should favor open margins and visible whitespace. Avoid dense stacking; the design works because content is given room to settle.

## Elevation & Depth
The system is notably flat and low-shadow. Depth is created through contrast, framing, and photography rather than through layered shadows or floating surfaces. Borders are very subtle, and when used, they function as structure instead of decoration.

Because the background is warm and bright, content separation comes from tonal shifts, image edges, and spacing. Buttons and cards should rely on fill color and border weight rather than drop shadows. This keeps the experience clean and grounded.

## Shapes
The shape language is soft but restrained. Corners are mostly small-radius, with 4px corners on buttons and an 8px radius on cards, producing a practical, lightly rounded look. The overall feel is architectural and simple rather than playful.

Use full rounding only for chips, badges, and icon bubbles where a more organic pill shape is appropriate. Avoid exaggerated curves on major containers; the brand works best when geometry stays disciplined.

## Components
Buttons are understated and text-forward. `button-primary` uses the warm beige fill with a dark border and compact 4px radius, making it feel tactile but not loud. `button-secondary` is transparent with a thin dark border for lower-emphasis actions, while `button-link` should appear as plain underlined text with no container. Button text remains very small and compact, so spacing and hit area should preserve usability without visually inflating the style.

Cards should use `card` styling: white background, 1px light-gray border, 8px radius, and 16px padding. Keep cards clean and avoid shadow-based elevation. They should feel like gentle content frames rather than panels competing for attention.

Inputs should follow the same calm logic as cards: white fill, dark text, subtle border, and small-radius corners. Focus states can use the secondary olive tone or a slightly stronger border rather than glow effects. Labels should remain concise and modest in size.

Chips should be pill-shaped using `rounded.full`, with muted beige fills and compact padding. They work best for category filters, tags, and small status labels. Icon buttons, social buttons, and floating contact affordances should be circular or nearly circular, with solid dark or muted green fills and simple white iconography.

Navigation items should stay minimal and typographic, with one active state in the secondary accent. Avoid boxed nav tabs or heavy underlines. The brand favors text hierarchy over widget-heavy treatment.

## Do's and Don'ts
- Do keep the interface open and airy, with large blocks of whitespace.
- Do use black text for primary readability and the muted green-beige palette only as an accent.
- Do preserve the contrast between expressive Hebrew display headings and plain utility text.
- Do keep corners modest: 4px on buttons, 8px on cards, full radius only for pills and icon bubbles.
- Do use borders and spacing for structure instead of shadows.
- Don't introduce bright, saturated colors that break the calm café mood.
- Don't use oversized button chrome, heavy gradients, or flashy depth effects.
- Don't crowd sections with dense layouts; the design should always feel composed and spacious.