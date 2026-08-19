<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.svg">
    <img alt="next-memcached" src="assets/logo-light.svg" width="480">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/seatgeek/next-memcached/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/seatgeek/next-memcached/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://www.npmjs.com/package/@seatgeek/next-memcached"><img alt="npm version" src="https://img.shields.io/npm/v/%40seatgeek%2Fnext-memcached"></a>
  <a href="https://packagephobia.com/result?p=%40seatgeek%2Fnext-memcached"><img alt="install size" src="https://packagephobia.com/badge?p=%40seatgeek%2Fnext-memcached"></a>
  <a href="./nextjs-compatibility.md"><img alt="Next.js >= 16.3" src="https://img.shields.io/badge/Next.js-%E2%89%A516.3-black"></a>
  <a href="../package.json"><img alt="Node >= 22.19" src="https://img.shields.io/badge/Node-%E2%89%A522.19-brightgreen"></a>
  <a href="../LICENSE"><img alt="license: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
</p>

Memcached as the shared cache behind Next.js [`cacheHandlers`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers) (`'use cache'` / Cache Components). Built for self-hosted deployments (Kubernetes, ECS, bare VMs) where every pod must share one cache instead of keeping its own in-memory LRU.

**Fail-safe by construction: a dead memcached costs you cache misses, never render errors, and never stale data.**

## Principles

1. **Native.** A drop-in `cacheHandlers` implementation. One config entry plus one env var, and the default export is the handler instance Next.js already expects, so there's no custom wiring and no surprising deviation from the documented interface.
2. **Reliable.** Consistent, correct content over raw speed. Where the two trade off, correctness wins, and a slow or dead cache degrades to "no caching," never to stale or broken output. [Roadmap](./roadmap.md): a built-in circuit breaker that trips this same fallback automatically under sustained failure instead of relying on per-op timeouts alone.
3. **Observable.** Instrumented so operators can see what the cache is doing, not just guess from application logs. [Roadmap](./roadmap.md): first-class telemetry, metrics and traces, out of the box.

## Highlights

- **AWS ElastiCache Serverless ready.** TLS via `memcaches://`, text protocol only, TTL clamps that respect serverless LRU eviction. Tested against a real serverless cache.
- **O(1) tag invalidation, no key lists.** Hard (`updateTag`) and soft (`revalidateTag(tag, 'max')`, stale-while-revalidate) both supported; invalidation cost does not grow with the number of entries carrying the tag.
- **Every failure degrades to "no caching".** 750 ms op budget, versioned envelope (corrupt entries read as misses), eviction-safe tag records, a total exception guard on every method.
- **Proven in CI.** Integration suite against live memcached (plain and TLS), Node 22/24, and a Next.js compat matrix: 16.3 floor, latest 16.x, canary.

> [!WARNING]
> Pre-1.0, not yet published to npm, and under heavy development. Expect constant breaking changes to the config shape, the envelope format, and the exported API until v1.0.0 ships. Pin a commit, not a range, and re-read this doc before every update.

> [!NOTE]
> TLS support ships in the upstream [`memcache`](https://www.npmjs.com/package/memcache) client since 1.10.0 ([SeatGeek's contribution](https://github.com/jaredwray/memcache/pull/115)).

## Install

```sh
npm install @seatgeek/next-memcached   # or pnpm add / yarn add / bun add
```

Requires Node >= 22.19 and Next.js >= 16.3 with Cache Components (see [Next.js compatibility](./nextjs-compatibility.md)).

## Quick start

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

Point it at memcached:

```sh
# plain
MEMCACHED_URI=localhost:11211
# ElastiCache Serverless (TLS)
MEMCACHED_URI=memcaches://my-cache.serverless.use1.cache.amazonaws.com:11211
```

Two details are easy to get wrong: the default export is the handler **instance** (not a factory), and **`cacheMaxMemorySize: 0` is not optional** (without it, an outage silently degrades to divergent per-pod caching). Both are explained in [getting started](./getting-started.md#2-turn-on-cache-components-and-point-at-the-handler).

## Documentation

Everything past the quick start lives alongside this file:

| Doc | Contents |
| --- | --- |
| [Getting started](./getting-started.md) | Config reference, first cached function, the example app, links to Vercel's own docs |
| [How it works](./how-it-works.md) | Keys, envelope, tag versioning, failure modes, TTL clamp, the page-level cache trap |
| [Roadmap](./roadmap.md) | Compression, circuit breaker, benchmarks, larger items, telemetry, external logger, protocol and pooling evaluations, Next.js 15 |
| [Next.js compatibility](./nextjs-compatibility.md) | Supported versions, feature compatibility matrix, the CI compat matrix |
| [Contributing](./CONTRIBUTING.md) | Setup, quality gates, example smoke test |
| [Releasing](./RELEASING.md) | Tag-driven publish flow, guards, one-time npm setup |
| [Security](./SECURITY.md) | Reporting, and the memcached no-auth threat model |

Package invariants (fail-safe methods, never-stale eviction semantics, stream draining, TTL clamps) live in [AGENTS.md](../AGENTS.md) and are enforced by tests and CI.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Vercel or Amazon Web Services. "Next.js" and "Vercel" are trademarks of Vercel, Inc. "Amazon ElastiCache" is a trademark of Amazon.com, Inc. or its affiliates. memcached is a project of the memcached community (see [memcached.org](https://memcached.org)).

## License

[Apache-2.0](../LICENSE) © SeatGeek
