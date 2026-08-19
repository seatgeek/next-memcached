import { defineConfig } from "tsup";

// Single entry, dual format. `memcache` (the only runtime dependency) stays
// external — tsup externalizes package.json dependencies by default.
// The module's default export is the handler INSTANCE (Next.js loads
// `cacheHandlers.<kind>` via interopDefault and expects the instance);
// both formats resolve to the same singleton in practice because Next
// imports the package exactly once per server process.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: "node22",
  platform: "node",
});
