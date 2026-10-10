#!/usr/bin/env node
// Render an RTL (Hebrew) HTML file to PDF with headless Chrome/Edge, then run checks.
// Usage: node render-pdf.mjs <input.html> <output.pdf> [--chrome <path>] [--wait <ms>]
// No npm dependencies: uses the browser already installed on the machine.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const chromeArg = flag("--chrome");
const waitMs = Number(flag("--wait") ?? 15000);
const [input, output] = args;

if (!input || !output) {
  console.error("Usage: node render-pdf.mjs <input.html> <output.pdf> [--chrome <path>] [--wait <ms>]");
  process.exit(2);
}

const inputPath = resolve(input);
const outputPath = resolve(output);
if (!existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(2);
}

function findBrowser() {
  const candidates = [
    chromeArg,
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

// ---------- pre-checks on the HTML ----------
const html = readFileSync(inputPath, "utf8");
const warnings = [];

if (!/<html[^>]*\bdir\s*=\s*["']rtl["']/i.test(html)) warnings.push('<html> has no dir="rtl"');
if (!/<html[^>]*\blang\s*=\s*["']he["']/i.test(html)) warnings.push('<html> has no lang="he"');

// Invisible / bidi control characters (written as escapes on purpose).
const invisible = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const found = [...html.matchAll(invisible)];
if (found.length) {
  const codes = [...new Set(found.map((m) => "U+" + m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")))];
  warnings.push(`${found.length} invisible/bidi control chars (${codes.join(", ")}). Use dir="ltr" or <bdi> instead.`);
}

const hrefs = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
const ids = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]));
const external = hrefs.filter((h) => /^(https?:|mailto:|tel:)/i.test(h));
const internal = hrefs.filter((h) => h.startsWith("#"));
for (const h of hrefs) if (!h.trim()) warnings.push("an <a> has an empty href");
for (const h of internal) if (h.length > 1 && !ids.has(decodeURIComponent(h.slice(1)))) warnings.push(`internal link ${h} has no matching id`);
for (const h of hrefs) if (/^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(h)) warnings.push(`link points to localhost: ${h}`);

// ---------- render ----------
const browser = findBrowser();
if (!browser) {
  console.error("No Chrome/Edge found. Pass --chrome <path> or set CHROME_PATH.");
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "hebrew-pdf-"));
const result = spawnSync(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    "--no-pdf-header-footer",
    "--run-all-compositor-stages-before-draw",
    `--virtual-time-budget=${waitMs}`,
    `--print-to-pdf=${outputPath}`,
    pathToFileURL(inputPath).href,
  ],
  { encoding: "utf8", timeout: waitMs + 60000 },
);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // the browser may still hold a lock on Windows; the temp dir is harmless
}

if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
  console.error("PDF was not created.");
  console.error(result.error?.message ?? result.stderr);
  process.exit(1);
}

// ---------- post-checks on the PDF ----------
const pdf = readFileSync(outputPath).toString("latin1");
const pages = (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
const uriLinks = (pdf.match(/\/URI\s*\(/g) ?? []).length;
const internalLinks = (pdf.match(/\/Dest\s*[(/[]/g) ?? []).length;

console.log(`PDF: ${outputPath}`);
console.log(`Browser: ${browser}`);
console.log(`Pages: ${pages}  Size: ${(statSync(outputPath).size / 1024).toFixed(0)} KB`);
console.log(`Clickable external links: ${uriLinks} (HTML has ${external.length})`);
console.log(`Clickable internal links: ${internalLinks} (HTML has ${internal.length})`);
if (uriLinks < new Set(external).size) warnings.push("fewer external links in the PDF than unique hrefs in the HTML (hidden element?)");

if (warnings.length) {
  console.log("\nWarnings:");
  for (const w of warnings) console.log(`  - ${w}`);
  process.exitCode = 3;
} else {
  console.log("\nAll checks passed.");
}
