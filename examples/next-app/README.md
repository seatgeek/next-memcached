# next-memcached example

A runnable Next.js 16 (Cache Components) demo for
[`@seatgeek/next-memcached`](../../docs/README.md). One page shows every
behavior the handler implements:

- **Cached fragments across TTL profiles** (`short` / `long` / `verylong`
  cacheLife): each renders the moment it was produced, so a hit is visibly
  "old" and a miss visibly fresh.
- **Hard vs soft tag invalidation**: buttons call
  `revalidateTag(tag, { expire: 0 })` (immediate miss) and
  `revalidateTag(tag, "max")` (serve stale once, refresh in background);
  tag-a fragments change while tag-b fragments persist.
- **Single-entry invalidation** via a unique per-fragment tag (Next.js has no
  key-level invalidation API).
- **Per-session cached content**: the session id from a cookie is passed as
  an argument into the cached function (`'use cache: private'` never reaches
  custom handlers by Next.js design); two browsers see independently cached
  values.
- **Live memcached inspector**: a debug panel listing the raw `e:`/`t:` keys
  currently in memcached (via `stats` + `lru_crawler metadump` on a raw
  socket), proving entries live in the shared cache, not per-pod memory.

## Run it

From the **repo root**:

```sh
make services   # memcached in docker: plain :11211, TLS-only :21211
make example    # builds the package, then next dev on :3000
```

Or by hand: `pnpm install && pnpm build` at the root, then `pnpm dev` in this
directory. Environment:

| Var | Default | Meaning |
| --- | --- | --- |
| `MEMCACHED_URI` | `localhost:11211` | point at `memcaches://localhost:21211` to exercise the TLS path (set `MEMCACHED_TLS_CA=../../certs/cacert.pem`) |
| `NEXT_PRIVATE_DEBUG_CACHE` | unset | `1` logs every handler get/set decision |

## Things worth trying

1. Load the page twice: timestamps freeze (hits). Wait past a fragment's TTL
   and it refreshes alone.
2. Hard-invalidate `tag-a`: only tag-a fragments change.
3. Soft-invalidate `tag-a`: the first reload serves the old value (marked
   stale-while-revalidate), the second reload shows the refreshed one.
4. `docker compose stop` at the root: the app keeps serving with **zero
   errors**, every fragment recomputed per request (no silent per-pod memory
   fallback). `docker compose start`: caching resumes, and pre-outage
   entries do not resurrect stale.
5. Note the first-ever read of a new tag is a one-time miss by design (the
   fail-safe tag re-seed; see
   [docs/how-it-works.md](../../docs/how-it-works.md)).

The fragments render inside `await connection()` under `<Suspense>`. Without
that, fragments whose `stale` exceeds the route's stale-time get baked into
the per-pod static page shell and stop consulting the handler entirely (the
page-level-cache trap, also covered in how-it-works).
