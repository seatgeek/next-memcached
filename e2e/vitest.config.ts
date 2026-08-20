import { defineConfig } from "vitest/config";
import { MODE } from "./helpers";

// E2E suite: real `next start` of examples/next-app over live memcached.
// Deliberately NO coverage block - the src/ coverage ratchet lives in the
// root vitest.config.ts and must not see these files. Scenarios share the
// running server's cache state, so files run serially.
//
// The JUnit file (named per E2E_MODE so plain/TLS runs don't clobber each
// other) is what CI publishes as the job's test report.
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    globalSetup: ["e2e/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
    reporters: ["default", "junit"],
    outputFile: { junit: `e2e/reports/junit-${MODE}.xml` },
  },
});
