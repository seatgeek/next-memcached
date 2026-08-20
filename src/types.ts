/**
 * Local mirror of Next.js's `cacheHandlers` (v2) types.
 *
 * Source of truth: `packages/next/src/server/lib/cache-handlers/types.ts`
 * in vercel/next.js (shipped as `next/dist/server/lib/cache-handlers/types.d.ts`):
 * https://github.com/vercel/next.js/blob/canary/packages/next/src/server/lib/cache-handlers/types.ts
 *
 * Mirrored rather than imported: that path is Next-internal (not public
 * API), and importing it would leak the internal path into our published
 * `.d.ts` and require a `next` peer dependency. See
 * docs/nextjs-compatibility.md for the full rationale.
 *
 * Drift protection: the CI compat matrix builds the example app against the
 * floor (16.3.0), latest 16.x, and canary, and
 * `examples/next-app/lib/handler-type-compat.ts` asserts at compile time
 * that the handler stays assignable to Next's real `CacheHandler`. If Next
 * changes the contract, that guard fails before this mirror silently lies.
 * Last hand-verified against next@16.3.0.
 *
 * Upstream: https://github.com/vercel/next.js/pull/97592 (ours) proposes a
 * public types-only `next/cache-handlers` entrypoint; once released, point
 * handler-type-compat.ts at it instead of the internal dist path.
 */

/**
 * Mirrors `CacheEntry` from Next's cache-handlers types (same file as
 * above). Field names, types, and unit semantics must match exactly: the
 * envelope persists these fields verbatim and Next compares them
 * arithmetically (e.g. miss when `now > timestamp + revalidate * 1000`).
 */
export interface CacheEntry {
  value: ReadableStream<Uint8Array>;
  /** Tags configured for the entry, excluding soft (implicit) tags. */
  tags: string[];
  /** Client-side staleness hint [duration in seconds]. */
  stale: number;
  /** When the entry was created [absolute milliseconds since epoch]. */
  timestamp: number;
  /** How long the entry may be used [duration in seconds from timestamp]. */
  expire: number;
  /** How long until the entry should be revalidated [duration in seconds]. */
  revalidate: number;
}

/**
 * NOT a Next.js type: a local convenience shape. Next 16.3 passes `set()` a
 * `Promise<CacheEntry>` (the whole entry pending, its `value` a plain stream
 * once resolved); this object-with-pending-stream variant is kept from
 * earlier iterations of the interface, and the handler accepts both.
 */
export interface PendingCacheEntry extends Omit<CacheEntry, "value"> {
  value: Promise<ReadableStream<Uint8Array>>;
}

/**
 * Mirrors the `CacheHandler` interface from Next's cache-handlers types
 * (named `CacheHandlerV2` here to distinguish it from the legacy pre-16
 * `cacheHandler` contract, which this package does not implement). Method
 * signatures must stay assignable to Next's original: the compile-time
 * guard in the example app enforces this against each supported version.
 * One deviation is allowed by design: `set()` additionally accepts
 * `PendingCacheEntry` (a wider parameter, so still assignable).
 */
export interface CacheHandlerV2 {
  get(cacheKey: string, softTags: string[]): Promise<CacheEntry | undefined>;
  set(
    cacheKey: string,
    pendingEntry: PendingCacheEntry | Promise<CacheEntry>,
  ): Promise<void>;
  refreshTags(): Promise<void>;
  getExpiration(tags: string[]): Promise<number>;
  updateTags(tags: string[], durations?: { expire?: number }): Promise<void>;
}
