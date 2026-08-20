import { defineConfig } from "vitest/config";

// The suite is an INTEGRATION suite: it exercises the handler against live
// memcached services (`pnpm test:services:start` — plain :11211, TLS-only
// :21211). Coverage thresholds pin what the suite actually reaches; raise
// them with new tests, never lower them to merge. See docs/CONTRIBUTING.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Tests are colocated with the code; types.ts is type-only.
      exclude: ["src/**/*.test.ts", "src/types.ts"],
      thresholds: {
        lines: 98,
        functions: 97,
        branches: 93,
        statements: 97,
      },
    },
  },
});
