import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Physical-direction Tailwind classes break RTL layout; use logical ones
// (ms-/me-/ps-/pe-/start-/end-/text-start/text-end, rounded-s/e, border-s/e).
const PHYSICAL_DIRECTION =
  "/(^|[\\s:])-?(ml|mr|pl|pr|left|right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|scroll-m[lr]|scroll-p[lr])(-|\\s|$)|(^|[\\s:])text-(left|right)(\\s|$)/"
const RTL_MESSAGE =
  "RTL site: use logical Tailwind classes (ms-/me-/ps-/pe-/start-/end-/text-start/text-end) instead of left/right ones."

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=${PHYSICAL_DIRECTION}]`, message: RTL_MESSAGE },
        { selector: `TemplateElement[value.raw=${PHYSICAL_DIRECTION}]`, message: RTL_MESSAGE },
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
