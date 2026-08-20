# @seatgeek/next-memcached

## 0.0.2

### Patch Changes

- Ship the README in the published tarball (`prepack` copies `docs/README.md` into the package root; `postpack` removes it).

## 0.0.1

### Patch Changes

- Initial release: Next.js 16 `cacheHandlers` ('use cache' / Cache Components) implementation backed by memcached. Fail-safe by construction (a dead memcached costs misses, never render errors or stale data), AWS ElastiCache Serverless ready (TLS via `memcaches://`, text protocol, serverless-safe TTL clamps), O(1) hard/soft tag invalidation without key lists.

This changelog is managed by [changesets](https://github.com/changesets/changesets). Entries are generated from `.changeset/*.md` files when a release is versioned.
