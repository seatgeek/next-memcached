# Getting started

This walks through wiring `@seatgeek/next-memcached` into a Next.js 16 app from a clean install. For the full design (envelope format, tag invalidation, TTL clamping, failure modes) see [docs/how-it-works.md](./how-it-works.md). For the underlying Next.js feature itself, see the [`cacheHandlers` docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers) and the [Cache Components docs](https://nextjs.org/docs/app/getting-started/cache-components).

> [!WARNING]
> Pre-1.0.0, under heavy development, with constant breaking changes. Re-read this doc before every update.

## Prerequisites

- Node >= 22.19
- Next.js >= 16.3 with Cache Components enabled (see [Next.js compatibility](./nextjs-compatibility.md))
- A memcached instance reachable from every pod: local docker for development, AWS ElastiCache Serverless (or any memcached that speaks the text protocol) in production

## 1. Install

```sh
npm install @seatgeek/next-memcached   # or pnpm add / yarn add / bun add
```

## 2. Turn on Cache Components and point at the handler

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  cacheHandlers: {
    default: require.resolve("@seatgeek/next-memcached"),
  },
  // Disable Next's default in-memory LRU so memcached is authoritative.
  cacheMaxMemorySize: 0,
};

export default nextConfig;
```

Two things matter here, both easy to get wrong:

- The module's **default export is the handler instance**, not a factory. Next loads `cacheHandlers.<kind>` via `interopDefault(await import(path))` and expects the instance directly, so `require.resolve(...)` (not a call) is correct.
- **`cacheMaxMemorySize: 0` is not optional.** Leave the in-memory LRU on and a down or missing shared backend silently degrades to per-pod memory caching, so pods behind a load balancer serve inconsistent content and nothing errors. Setting it to `0` makes this handler the only `'use cache'` store: an outage degrades to "no caching" instead of "divergent caching".

## 3. Point it at memcached

```sh
# local / plain text protocol
MEMCACHED_URI=localhost:11211

# AWS ElastiCache Serverless (TLS mandatory)
MEMCACHED_URI=memcaches://my-cache.serverless.use1.cache.amazonaws.com:11211

# optional: a CA bundle for TLS targets that aren't in Node's default trust store
MEMCACHED_TLS_CA=/path/to/ca.pem
```

`memcaches://` (note the extra `s`) switches the client to TLS; plain `host:port` stays on the text protocol. Without `MEMCACHED_TLS_CA`, TLS targets use Node's default trust store, which already covers ElastiCache's ACM-issued certs.

The full settings surface:

| Setting | Default | Meaning |
| --- | --- | --- |
| `MEMCACHED_URI` env var | `localhost:11211` | memcached target, `host:port` or `memcaches://host:port` (TLS) |
| `MEMCACHED_TLS_CA` env var | unset | path to a CA bundle (PEM) for TLS targets |
| operation timeout | 750 ms | hard budget per memcached op; not configurable yet |
| retries | 0 | failed ops are not retried |

For programmatic use (e.g. tests), `createMemcachedCacheHandler({ uri })` is exported alongside the default instance.

For local development, `docker compose` in the repo's `handler/` directory brings up both a plain instance on `:11211` and a TLS-only one on `:21211`:

```sh
make services
```

## 4. Write your first cached function

```tsx
// app/page.tsx
import { cacheLife, cacheTag } from "next/cache";

async function Greeting() {
  "use cache";
  cacheLife("minutes"); // or a custom profile from cacheLife config
  cacheTag("greeting");
  return <p>Hello, cached at {new Date().toISOString()}</p>;
}

export default function Page() {
  return <Greeting />;
}
```

Reload the page: the timestamp freezes until the profile's `stale` window passes, then refreshes on the next request. Invalidate on demand from a server action or route handler:

```ts
import { revalidateTag } from "next/cache";

revalidateTag("greeting", { expire: 0 }); // hard: next read is an immediate miss
revalidateTag("greeting", "max"); // soft: next read serves stale once, refreshes in the background
```

## 5. Watch out for the page-level cache

`cacheHandlers` replaces the **data cache**, not Next's separate page-level incremental cache; fragments can get baked into the per-pod static shell and stop consulting this handler ([why, and what happens if you skip this](./how-it-works.md#important-the-page-level-cache-is-a-separate-layer)). If that matters for a given route, render the cached fragments inside a dynamic subtree:

```tsx
import { connection } from "next/server";
import { Suspense } from "react";

async function CachedSections() {
  await connection(); // opts this subtree out of the prerendered shell
  return <Greeting />;
}

export default function Page() {
  return (
    <Suspense fallback="loading">
      <CachedSections />
    </Suspense>
  );
}
```

## 6. Run the example app

[`examples/next-app`](../examples/next-app) is a runnable demo covering everything above plus tag invalidation (hard and soft), per-session cached content, and a live memcached key inspector. From the repo root:

```sh
make services   # memcached in docker (plain :11211, TLS :21211)
make example    # builds the package, then next dev on :3000
```

The [example's own README](../examples/next-app/README.md) walks through things worth trying, including killing memcached mid-run to watch the app keep serving with zero errors.

## Further reading

- [How it works](./how-it-works.md): keys, envelope format, tag invalidation, TTL clamping, failure modes, limitations
- [Roadmap](./roadmap.md): compression, circuit breaker, benchmarks, larger items, telemetry, external logger, protocol and pooling evaluations, Next.js 15
- [Next.js compatibility](./nextjs-compatibility.md): supported versions and the CI compat matrix
- Vercel's own docs: [`cacheHandlers` config reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers), [Cache Components guide](https://nextjs.org/docs/app/getting-started/cache-components), [`cacheLife`](https://nextjs.org/docs/app/api-reference/functions/cacheLife), [`cacheTag`](https://nextjs.org/docs/app/api-reference/functions/cacheTag), [`revalidateTag`](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)
