/**
 * Compile-time guard: the handler's locally-mirrored types (src/types.ts)
 * must stay assignable to Next.js's real cacheHandlers interface. This file
 * is type-checked by `next build` — and by the CI compat matrix against
 * every supported Next.js version — and is never imported or executed.
 *
 * The import path is Next-internal. If it moves, or the interface changes
 * shape (as it did when expireTags became updateTags), this file fails the
 * compat leg — which is exactly the signal it exists to produce.
 */
import handler, { createMemcachedCacheHandler } from "@seatgeek/next-memcached";
import type { CacheHandler } from "next/dist/server/lib/cache-handlers/types";

// The default export (what `cacheHandlers.default` resolves to via
// interopDefault) must satisfy Next's CacheHandler contract…
const _defaultInstance: CacheHandler = handler;

// …and so must programmatically created instances.
const _customInstance: CacheHandler = createMemcachedCacheHandler({
  uri: "localhost:11211",
});
