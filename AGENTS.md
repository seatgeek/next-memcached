# AGENTS.md

Instructions for AI coding agents (and a good summary for humans). This file owns the file map, the behavioral invariants, and the rules of engagement; everything else lives in the docs it links to.

## What this package is

`@seatgeek/next-memcached` implements the [Next.js 16 `cacheHandlers`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers) (v2) interface on top of memcached. Pitch, principles, and quick start: [docs/README.md](./docs/README.md). Design deep-dive: [docs/how-it-works.md](./docs/how-it-works.md). Scope per Next.js feature: [the compatibility matrix](./docs/nextjs-compatibility.md#feature-compatibility-matrix). Planned work: [docs/roadmap.md](./docs/roadmap.md).

> [!WARNING]
> Pre-1.0.0, under heavy development, with constant breaking changes to the config shape, the envelope format, and the exported API. Don't assume anything you read here or in prior training data still holds; re-read the current source and this file before making changes.

The [principles](./docs/README.md#principles) are priority-ordered (native > reliable > observable, with reliability beating performance). When a change trades one against another, prefer the higher-priority one and say so in the PR description. Performance work that risks returning inconsistent content needs a strong justification.

## File map

| File | What |
| --- | --- |
| `src/index.ts` | The five handler methods + default export (Next expects the **instance** as default export, not a factory); `pendingSets`, TTL clamp, stream drain/rebuild |
| `src/envelope.ts` | JSON string envelope v1 (`{v, tags, stale, timestamp, expire, revalidate, body:b64}`); decode failure reads as a miss; >900 KB encode is skipped |
| `src/tags.ts` | Per-tag `{expired, stale}` records (`t:<sha1>` keys), fail-safe re-seed on missing records, `bumpTags` hard/soft write logic; mirrors Next's built-in tags-manifest algorithm |
| `src/memcached-client.ts` | Lazy singleton `Memcache` client; `MEMCACHED_URI` env (default `localhost:11211`, `memcaches://` = TLS), `MEMCACHED_TLS_CA` env (CA bundle path), 750 ms timeout, retries 0 |
| `src/types.ts` | Local mirror of Next 16.3's `cacheHandlers` types; provenance and the no-peer-dep rationale are annotated in the file, verified per Next version by the CI `compat` matrix + `examples/next-app/lib/handler-type-compat.ts` |
| `src/index.test.ts` | Integration suite, colocated with the code; needs live memcached (`make services`) |
| `src/tls.test.ts` | TLS integration suite; needs the compose stack's `memcached-tls` (:21211, checked-in certs under `certs/`) |
| `src/envelope.test.ts` | Pure unit tests for the envelope |
| `examples/next-app` | Runnable Next.js 16 demo + manual smoke test (workspace member) |

## Invariants (do not weaken)

1. Every handler method body is a **total try/catch returning the safe default** (miss / no-op). `get()` must never throw; cache-down must never surface as a render error.
2. A missing tag record must always read as `{expired: now}` (fail-safe: eviction costs an extra miss, **never stale data**). Re-seed uses `add`, not `set`, so a concurrent real invalidation wins.
3. Envelope decode failures (including unknown versions) are misses; any envelope format change requires bumping `ENVELOPE_VERSION`.
4. `set()` must fully drain the entry stream on **every** path, including skips; an unread stream stalls Next's render.
5. TTLs passed to memcached stay in [1 s, 30 d]; never pass 0 (the client treats it as "never expire", exempt from ElastiCache Serverless LRU, an OOM risk).
6. No tag-to-keys indexes, no key enumeration; tag invalidation stays O(1) versioned-record comparison (an evicted key list would serve stale data forever).
7. No `next` import in `src/`; the handler types are mirrored locally so the package works across Next versions without a peer dependency.

The reasoning behind each lives in [docs/how-it-works.md](./docs/how-it-works.md).

## Rules of engagement

- **Extend, don't redesign.** The handler is deliberately a thin adapter; new capability should fit the invariants above or live in the consumer's app.
- Sources of truth: Next.js's own `default.js` in-memory handler (`next/dist/server/lib/cache-handlers/`) for interface semantics (read it, don't work from memory), and the [memcached protocol docs](https://github.com/memcached/memcached/blob/master/doc/protocol.txt) for server behavior.
- Tests are integration tests against live memcached; start services first (`make services`). Coverage thresholds in `vitest.config.ts` only go up.
- `memcache` `^1.10.0` is the floor: first release with TLS (annotated in `src/memcached-client.ts`). Never lower it.
- Keep the published tarball minimal; see [package minimality](./docs/CONTRIBUTING.md#package-minimality).
- Never publish. Releases are tag-driven and multiply gated per [docs/RELEASING.md](./docs/RELEASING.md); merging to `main` must never publish.

## Commands

```sh
make init       # brew bundle + mise install + pnpm install
make services   # docker compose up -d (memcached plain :11211, TLS :21211)
make check      # typecheck + lint + test + build + export checks
make test       # vitest with coverage (requires services)
make format     # biome auto-fix
make example    # build + run examples/next-app on :3000
make docs       # preview docs as GitHub renders them (:6419)
make pack-check # npm pack --dry-run
```

Full development workflow: [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md).
