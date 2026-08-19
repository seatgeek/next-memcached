# Next.js compatibility

- **Primary target: Next.js 16.x with Cache Components; the floor is 16.3.** The package implements the [`cacheHandlers`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers) (v2) interface as shipped in 16.3: five methods, `ReadableStream` values, `updateTags(tags, durations?)`. The interface churned during the 16.0 canary line (`expireTags` was renamed to `updateTags` in October 2025), so earlier 16.x and 15.x canaries are not supported.
- **Zero runtime coupling to `next`, and deliberately no `next` peer dependency, not even for types.** The handler never imports from `next` (CI enforces this with a grep guard); the interface types are mirrored locally in `src/types.ts`. Sourcing them from `next` instead would mean importing from a Next-internal path (`next/dist/server/lib/cache-handlers/types`, not public API), which would leak that path into the published `.d.ts` and make every consumer's typecheck resolve into Next internals, and a peer range would emit installer warnings on every new Next major until bumped. The mirror plus per-version CI verification (below) gives the same drift protection without either cost.
- **The mirror is verified per-version in CI**, two ways, by the `compat` matrix (floor `16.3.0`, latest `16`, and `canary` as a non-blocking early-warning leg):
  - `examples/next-app/lib/handler-type-compat.ts` asserts at compile time that the handler instance is assignable to Next's own internal `CacheHandler` interface (`next/dist/server/lib/cache-handlers/types`); if Next changes the contract, this fails the leg.
  - The example app is built against each version with live memcached, so `'use cache'` fragments actually prerender through the handler.
- **The default export is the handler instance, not a factory.** Next loads `cacheHandlers.<kind>` via `interopDefault(await import(path))` and uses the module's default export directly. Wiring details and the other config trap (`cacheMaxMemorySize: 0`) are in [getting started](./getting-started.md#2-turn-on-cache-components-and-point-at-the-handler).
- **The page-level incremental cache is a separate layer** that `cacheHandlers` does not replace; [how-it-works.md](./how-it-works.md#important-the-page-level-cache-is-a-separate-layer) explains it and the `await connection()` opt-out. Everything else that's in or out of scope is in the matrix below.

## Feature compatibility matrix

✅ supported · 🗺️ planned ([roadmap](./roadmap.md)) · ❌ not a target. Each feature links to Vercel's docs.

### `'use cache'` / Cache Components

| Feature | Status | Notes |
| --- | --- | --- |
| [`cacheComponents`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) | ✅ | Required |
| [`cacheHandlers`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers) config | ✅ | Point `cacheHandlers.default` at this package |
| [`'use cache'`](https://nextjs.org/docs/app/api-reference/directives/use-cache) | ✅ | The core path |
| [`cacheLife()`](https://nextjs.org/docs/app/api-reference/functions/cacheLife) profiles | ✅ | Built-in and custom; TTLs clamped to [1 s, 30 d] |
| [`cacheTag()`](https://nextjs.org/docs/app/api-reference/functions/cacheTag) | ✅ | O(1) versioned tag records |
| [`updateTag(tag)`](https://nextjs.org/docs/app/api-reference/functions/updateTag) | ✅ | Hard invalidation; Server Actions only per Vercel's docs |
| [`revalidateTag(tag, { expire: 0 })`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) | ✅ | Hard: next read is a miss |
| [`revalidateTag(tag, 'max')`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) | ✅ | Soft: stale-while-revalidate |
| [`revalidatePath(path)`](https://nextjs.org/docs/app/api-reference/functions/revalidatePath) | ✅ | Via implicit route tags; the page shell is a [separate layer](./how-it-works.md#important-the-page-level-cache-is-a-separate-layer) |
| [`'use cache: remote'`](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote) and custom kinds | ✅ | Any kind name maps to a handler module ([config schema](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/config-schema.ts), [kind resolution](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/use-cache/handlers.ts)); point it at this same module |
| [`'use cache: private'`](https://nextjs.org/docs/app/api-reference/directives/use-cache-private) | ❌ | Its handler can't be customized, per Vercel's docs; pass the session id as a function argument instead |

### Legacy caching (the pre-16 [`cacheHandler`](https://nextjs.org/docs/app/api-reference/config/next-config-js/incrementalCacheHandlerPath) interface)

A different, older contract this package does not implement. An adapter is planned but not a priority; until then these run on Next's defaults (per-pod disk/memory), unaffected by this package.

| Feature | Status |
| --- | --- |
| `fetch` data cache ([`force-cache`, `next.revalidate`, `next.tags`](https://nextjs.org/docs/app/api-reference/functions/fetch)) | 🗺️ |
| [`unstable_cache()`](https://nextjs.org/docs/app/api-reference/functions/unstable_cache) (deprecated in 16) | 🗺️ |
| [ISR](https://nextjs.org/docs/app/guides/incremental-static-regeneration) / [`generateStaticParams()`](https://nextjs.org/docs/app/api-reference/functions/generate-static-params) / [route segment config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config) | 🗺️ |
| [Pages Router caching](https://nextjs.org/docs/pages/guides/incremental-static-regeneration) | 🗺️ |
| Next.js 15 | 🗺️ |

### Backends

| Backend | Status | Notes |
| --- | --- | --- |
| memcached, text protocol | ✅ | Any memcached >= 1.6 |
| memcached over TLS (`memcaches://`) | ✅ | Via `memcache` >= 1.10.0 |
| AWS ElastiCache Serverless | ✅ | Tested against a real cache |
| Multi-node clusters (consistent hashing) | 🗺️ | Single target today |
| Binary / meta protocol | 🗺️ | Evaluation spike; serverless rejects binary |

Matrix format borrowed from [`@fortedigital/nextjs-cache-handler`](https://github.com/fortedigital/nextjs-cache-handler#feature-compatibility-matrix), which covers the inverse: the legacy interface on Redis, with the `'use cache'` surface unsupported. The two packages are complementary.
