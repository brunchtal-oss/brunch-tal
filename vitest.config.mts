import { fileURLToPath } from "node:url"
import { configDefaults, defineConfig } from "vitest/config"

const DB_DIR = "supabase/tests/**"
const DB_TESTS = "supabase/tests/**/*.test.{ts,tsx}"

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` throws outside a React Server environment; tests run in
      // plain Node, so map it to an empty module.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url)
      ),
    },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    projects: [
      {
        // Pure tests: no database, no env. `npm test` and CI run only these.
        extends: true,
        test: {
          name: "unit",
          include: ["**/*.test.ts", "**/*.test.tsx"],
          exclude: [...configDefaults.exclude, ".next/**", DB_DIR],
        },
      },
      {
        // Tests against the dev Supabase project (`npm run test:db`, local
        // only). Serial: they share one database and one connection budget.
        extends: true,
        test: {
          name: "db",
          include: [DB_TESTS],
          exclude: [...configDefaults.exclude],
          fileParallelism: false,
          // Loads .env.local, checks DEV_DATABASE_URL before connecting,
          // runs cleanups and closes the pool after each file.
          setupFiles: ["supabase/tests/support/setup.ts"],
        },
      },
    ],
  },
})
