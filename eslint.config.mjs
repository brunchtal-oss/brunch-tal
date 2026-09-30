import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Enforcement of ARCHITECTURE-SPINE › Consistency Conventions › אכיפה.
//
// Flat config replaces the whole `no-restricted-syntax` list when a later entry
// matches the same file, so every entry below spells out its full list, built
// from these groups.

const TS_FILES = ["**/*.{ts,tsx}"];
const TEST_FILES = ["**/*.test.{ts,tsx}", "supabase/tests/**"];
const UI_FILES = ["components/ui/**"];

// Physical-direction Tailwind classes break RTL layout; use logical ones
// (ms-/me-/ps-/pe-/start-/end-/text-start/text-end, rounded-s/e, border-s/e).
// Not applied to components/ui/ (shadcn source).
const PHYSICAL_DIRECTION =
  "/(^|[\\s:])-?(ml|mr|pl|pr|left|right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|scroll-m[lr]|scroll-p[lr])(-|\\s|$)|(^|[\\s:])text-(left|right)(\\s|$)/";
const RTL_MESSAGE =
  "RTL site: use logical Tailwind classes (ms-/me-/ps-/pe-/start-/end-/text-start/text-end) instead of left/right ones.";
const RTL = [
  { selector: `Literal[value=${PHYSICAL_DIRECTION}]`, message: RTL_MESSAGE },
  { selector: `TemplateElement[value.raw=${PHYSICAL_DIRECTION}]`, message: RTL_MESSAGE },
];

// A "use client" module never imports server code (AD-4), whether by static
// import, dynamic import() or re-export, with the @/ alias or a relative path.
const USE_CLIENT = 'Program:has(> ExpressionStatement[directive="use client"])';
// Matches "@/lib/server/...", "../../lib/server/..." and "../server/..." (from
// inside lib/), not package subpaths such as "react-dom/server".
const SERVER_PATH = String.raw`/^(@\/lib\/|(\.\.?\/)+(lib\/)?)server(\/|$)/`;
const CLIENT_MESSAGE =
  'A "use client" module must not import lib/server/** (AD-4). Call a Server Action instead.';
const CLIENT_IMPORTS = [
  "ImportDeclaration",
  "ImportExpression",
  "ExportNamedDeclaration",
  "ExportAllDeclaration",
].map((node) => ({
  selector: `${USE_CLIENT} ${node}[source.value=${SERVER_PATH}]`,
  message: CLIENT_MESSAGE,
}));

// Money, entitlements and bookings change only through an RPC (AD-5). The app
// writes directly only to the customer's own profile and babies (RLS).
// Storage buckets (`supabase.storage.from(...)`) are not tables. Test files
// are exempt.
const TABLE_WRITES = [
  {
    selector:
      'CallExpression[callee.property.name=/^(insert|update|delete|upsert)$/][callee.object.callee.property.name="from"]:not([callee.object.arguments.0.value=/^(profiles|babies)$/]):not([callee.object.callee.object.property.name="storage"])',
    message:
      "Direct table writes are allowed only for profiles and babies. Everything else goes through an RPC (AD-5).",
  },
];

// Money is integer agorot; never parse it as a float.
const MONEY_MESSAGE = "Money is integer agorot: no parseFloat in lib/money.ts.";
const NO_PARSE_FLOAT = [
  { selector: 'CallExpression[callee.name="parseFloat"]', message: MONEY_MESSAGE },
  // Number.parseFloat, globalThis.parseFloat, window.parseFloat...
  { selector: 'CallExpression[callee.property.name="parseFloat"]', message: MONEY_MESSAGE },
];

const restrictSyntax = (...groups) => ({
  "no-restricted-syntax": ["error", ...groups.flat()],
});

// lib/server/privileged (the service-role client) is imported only by itself,
// Server Actions, route handlers and the token pages that call getTokenView
// (AD-4, AD-10). Static imports go through no-restricted-imports; dynamic
// import() is not seen by that rule, so it is also in no-restricted-syntax.
// "[[]token[]]" is minimatch for the literal "[token]" folder.
const PRIVILEGED_ALLOWED = [
  "lib/server/privileged/**",
  "app/**/actions.ts",
  "app/api/**",
  "app/(auth)/reset/[[]token[]]/page.tsx",
  "app/(auth)/join/[[]token[]]/page.tsx",
];
const PRIVILEGED_REGEX = String.raw`^((@/lib/|(\.\.?/)+(lib/)?)server/|(\.\.?/)+)privileged(/|$)`;
const PRIVILEGED_MESSAGE =
  "lib/server/privileged is allowed only in lib/server/privileged, app/**/actions.ts, app/api/** and token pages (AD-4).";
const PRIVILEGED_DYNAMIC = [
  {
    selector: `ImportExpression[source.value=/${PRIVILEGED_REGEX.replaceAll("/", "\\/")}/]`,
    message: PRIVILEGED_MESSAGE,
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: TS_FILES,
    rules: restrictSyntax(RTL, CLIENT_IMPORTS, TABLE_WRITES, PRIVILEGED_DYNAMIC),
  },
  {
    files: UI_FILES,
    rules: restrictSyntax(CLIENT_IMPORTS, TABLE_WRITES, PRIVILEGED_DYNAMIC),
  },
  {
    files: TEST_FILES,
    ignores: UI_FILES,
    rules: restrictSyntax(RTL, CLIENT_IMPORTS, PRIVILEGED_DYNAMIC),
  },
  {
    files: ["components/ui/**/*.test.{ts,tsx}"],
    rules: restrictSyntax(CLIENT_IMPORTS, PRIVILEGED_DYNAMIC),
  },
  {
    files: ["lib/money.ts"],
    rules: restrictSyntax(RTL, CLIENT_IMPORTS, TABLE_WRITES, NO_PARSE_FLOAT, PRIVILEGED_DYNAMIC),
  },
  {
    files: PRIVILEGED_ALLOWED,
    ignores: TEST_FILES,
    rules: restrictSyntax(RTL, CLIENT_IMPORTS, TABLE_WRITES),
  },
  {
    // Test files inside the allowed places (both globs must match).
    files: PRIVILEGED_ALLOWED.map((glob) => [glob, TEST_FILES[0]]),
    rules: restrictSyntax(RTL, CLIENT_IMPORTS),
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    ignores: PRIVILEGED_ALLOWED,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: PRIVILEGED_REGEX,
              message: PRIVILEGED_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
