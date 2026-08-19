# Roadmap

Mid-term, not yet started:

- **Compression** for the envelope body, trading CPU for memcached item size and network bytes, on top of the current 900 KB write cap.
- **Automated circuit breaker**, tripping the same safe-default fallback under sustained failure instead of relying on the per-op 750 ms timeout alone.
- **Benchmark suite**, a committed, re-runnable set of throughput and latency numbers backing every performance claim, including a head-to-head against the built-in in-memory handler and against Redis.
- **First-class telemetry**: hit/miss/stale/error counters and an OTel adapter, so operators can see what the cache is doing instead of guessing from application logs.
- **Pluggable external logger.** Today the handler's only voice is `console.warn` behind `NEXT_PRIVATE_DEBUG_CACHE=1`. Accept an injected logger (a minimal `{ debug, warn, error }` interface, pino/winston/console all satisfy it) so warnings like skipped oversized entries and swallowed transport errors land in the app's structured logging instead of raw stdout. Silent-by-default stays: a missing logger must never change behavior.
- **Configurable maximum item size.** The 900 KB write cap assumes memcached's default 1 MB item limit, but the limit is raisable on both sides: self-hosted memcached via `-I` and AWS ElastiCache Serverless via a service quota increase (up to 10 MB). Make the cap configurable so deployments with a raised limit stop skipping large entries; skip-with-warning stays the behavior past whatever cap is set.

Longer-term, no timeline:

- **Multi-node consistent hashing.** `MEMCACHED_URI` currently takes one target; node-based clusters need distribution.
- **Evaluate binary/meta protocol support** (a spike, not a commitment). The classic binary protocol is officially deprecated in memcached 1.6 and rejected outright by ElastiCache Serverless, so the realistic candidate is the **meta text protocol** (`mg`/`ms`): readable flags, leaner responses, CAS. The evaluation gates on the benchmark suite: only pursue it if measurements show the classic text protocol leaving real performance on the table.
- **Evaluate optional connection pooling** (a spike, not a commitment). The upstream [`memcache` driver](https://github.com/jaredwray/memcache/blob/main/src/node.ts) holds exactly one pipelined socket per node, and the handler holds one client per process, so every request in a pod shares a single connection. Pipelining makes that efficient for small ops, but responses return strictly in order: one near-cap entry transfer head-of-line blocks everything queued behind it. If the benchmark suite shows that mattering under realistic traffic, add opt-in pooling, either as a stripe of N client instances inside the handler (contained change) or as a real pool upstream. Counterweight to keep in view: ElastiCache Serverless meters connection rate and count, so the default should stay one persistent connection.

Not a priority, but planned: **Next.js 15 support** via the legacy `cacheHandler` interface. Future Next.js versions (17.x and beyond) take priority over backfilling 15; see [Next.js compatibility](./nextjs-compatibility.md).

Current limitations that motivate these items are listed in [how-it-works.md](./how-it-works.md#current-limitations).
