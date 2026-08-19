import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheHandlers: {
    default: require.resolve("@seatgeek/next-memcached"),
  },
  // Disable the default in-memory LRU so the shared handler is authoritative
  // — otherwise a down/absent backend silently degrades to per-pod memory
  // caching (inconsistent content across pods, nothing errors).
  cacheMaxMemorySize: 0,
  cacheLife: {
    short: { stale: 5, revalidate: 5, expire: 10 },
    long: { stale: 300, revalidate: 300, expire: 600 },
    verylong: { stale: 3600, revalidate: 3600, expire: 86400 },
  },
  turbopack: {
    // The handler is consumed via the pnpm workspace rooted two levels up
    // (../../pnpm-workspace.yaml), so `next` and the handler resolve through
    // the workspace's node_modules. A standalone copy of this app (with a
    // published @seatgeek/next-memcached dependency) should remove
    // this override.
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
