---
name: hebrew-pdf
description: Turn a Hebrew (RTL) document into a designed PDF with clickable links, a cover, a table of contents and page numbers, using the site's look (Heebo, "קרם וזית" palette). Renders HTML through the installed Chrome/Edge, no npm packages. Use when the user asks to design, export or convert a document to PDF in Hebrew, e.g. "להמיר ל-PDF", "לעצב את המסמך", "מסמך ההגשה כ-PDF", "PDF עם קישורים".
---

# Hebrew PDF

A browser renders Hebrew, mixed Hebrew/English/numbers, and links correctly; PDF libraries
like reportlab do not. So: write the document as RTL HTML from `template.html`, then print
it to PDF with headless Chrome via `scripts/render-pdf.mjs`.

## Steps

1. **Get the content.** Read the source (markdown, text, or what the user pastes). Keep the
   wording exactly: this skill changes the look, never the text. If something seems missing
   or wrong, ask; do not invent content, links or numbers.
2. **Ask only what is missing** (one short question at most): the links to include (live
   site, repo, video, Figma…) and the cover details (title, name, course, date).
3. **Build the HTML** in the scratchpad directory (not in the repo) by copying `template.html`
   and filling it:
   - Cover, then table of contents, then one `<section class="chapter" id="...">` per
     main heading. Every TOC entry is `<a href="#id">` to a real `id`. Chrome cannot
     compute page numbers for the TOC, so do not type them. Add class `new-page` only to
     a chapter that should start on a fresh page (long chapters), not to every chapter.
   - Markdown maps to plain HTML: `##` to `h2`, `###` to `h3`, lists, tables, `**` to `strong`.
   - Important links (site, repo, demo) go in a `.links` card grid; others inline.
     Every link is a real `<a href="https://...">` with full URL.
   - Short notes in `.callout`. Images in `<figure>` with `figcaption`; reference image
     files by path relative to the HTML file.
   - Delete template sections you do not use. Keep the colours and fonts from the template
     (they come from DESIGN.md); the accent colour is decoration only, never text.
4. **Render:**
   ```
   node .claude/skills/hebrew-pdf/scripts/render-pdf.mjs <input.html> <output.pdf>
   ```
   The script finds Chrome or Edge, prints with A4 page settings from the CSS, and reports
   pages and link counts. Exit code 3 means warnings: fix each one and render again.
5. **Look at it.** Open the PDF with the Read tool (`pages: "1-5"`). If Read cannot render
   PDFs on this machine, use `scripts/preview.py` (its docstring shows how to install
   pypdfium2 + pillow into the scratchpad, not globally) and Read the PNGs. Check:
   text reads right to left; English words, numbers and URLs are not scrambled;
   no heading is alone at the bottom of a page; no table or card is cut in half;
   page numbers appear (not on the cover). Fix in the HTML and render again.
6. **Hand over** the PDF path, page count and number of clickable links. Ask the user before
   saving the PDF into the repo: the repo is public (see AGENTS.md).

## RTL rules

- `<html lang="he" dir="rtl">`. Use `text-align: start` and logical properties
  (`padding-inline-start`, `border-inline-start`), never `left`/`right`.
- English terms, product names and numbers with units inside Hebrew go in `<bdi>`.
  A URL shown as text goes in `<span class="url">` (LTR, isolated). Code is `<code>`/`<pre>` (LTR).
- Never type bidi control characters (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069) or
  zero-width characters. The renderer warns about them; replace them with `<bdi>` or `dir`.
- Bullets and numbering come from the list, never typed by hand, so they sit on the right.
- Parentheses and hyphens at the edge of a line jump when the run direction is unclear:
  wrap the mixed part in `<bdi>`.

## Troubleshooting

- **Font looks like Arial:** Heebo loads from Google Fonts, so it needs internet. Raise
  `--wait 30000`, or save Heebo locally and use `@font-face` with a relative `src`.
- **Link not clickable:** it was not an `<a href>`, or it sits inside an element hidden in
  print. Internal links need a matching `id`.
- **Blank or missing PDF:** pass the browser path with `--chrome <path>` or set `CHROME_PATH`.
- **Page break in a bad spot:** add `break-inside: avoid` to the block, or
  `break-before: page` to the heading that should start a page.
