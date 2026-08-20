import type { Memcache } from "memcache";
import { decodeEntry, encodeEntry } from "./envelope.js";
import { createClient, getSharedClient } from "./memcached-client.js";
import {
  bumpTags,
  isHardExpired,
  isSoftStale,
  readTagRecords,
  sha1hex,
} from "./tags.js";
import type { CacheEntry, CacheHandlerV2, PendingCacheEntry } from "./types.js";

export type { CacheEntry, CacheHandlerV2, PendingCacheEntry };

// memcached's max relative TTL. Values ≤0/NaN mean "never expire" to the
// client (opposite of memcached semantics, and TTL-0 items are exempt from
// serverless LRU), values >30d throw - so clamp to [1, 30d], never 0.
const MAX_TTL_SECONDS = 2_592_000;

export const entryKey = (cacheKey: string): string => `e:${sha1hex(cacheKey)}`;

const nowMs = (): number => performance.timeOrigin + performance.now();

const clampTtlSeconds = (seconds: number): number =>
  Number.isFinite(seconds)
    ? Math.min(Math.max(Math.ceil(seconds), 1), MAX_TTL_SECONDS)
    : MAX_TTL_SECONDS;

const streamFromBuffer = (body: Buffer): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(body));
      controller.close();
    },
  });

const drainToBuffer = async (
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  ) {
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
};

export interface MemcachedCacheHandlerOptions {
  /** Overrides MEMCACHED_URI / the default localhost:11211. */
  uri?: string;
}

export function createMemcachedCacheHandler(
  options?: MemcachedCacheHandlerOptions,
): CacheHandlerV2 {
  let client: Memcache | undefined;
  const getClient = (): Memcache => {
    client ??= options?.uri ? createClient(options.uri) : getSharedClient();
    return client;
  };

  // Mirrors the built-in handler: a get() racing a pending set() for the same
  // key waits for the write instead of returning a spurious miss.
  const pendingSets = new Map<string, Promise<void>>();

  // Every method body is a total try/catch returning the safe default -
  // a dead memcached degrades to "no caching", never to a render error.
  return {
    async get(cacheKey, softTags) {
      try {
        await pendingSets.get(cacheKey);
        const raw = await getClient().get(entryKey(cacheKey));
        if (raw === undefined) return undefined;
        const decoded = decodeEntry(raw);
        if (!decoded) return undefined;
        const now = nowMs();
        if (now > decoded.timestamp + decoded.revalidate * 1000) {
          return undefined;
        }
        // getExpiration() returns Infinity, which tells Next this handler
        // checks the soft (implicit) tags itself - so both the entry's own
        // tags and the softTags are checked here.
        const tags = [...new Set([...decoded.tags, ...softTags])];
        const records = [...(await readTagRecords(getClient(), tags)).values()];
        // Fresh timestamp for the expiry comparison, mirroring areTagsExpired
        // (which computes `now` at check time): a record fail-safe re-seeded
        // during readTagRecords carries `expired` later than the `now` above.
        const tagCheckNow = nowMs();
        if (
          records.some((record) =>
            isHardExpired(record, decoded.timestamp, tagCheckNow),
          )
        ) {
          return undefined;
        }
        const { body, ...metadata } = decoded;
        const revalidate = records.some((record) =>
          isSoftStale(record, decoded.timestamp),
        )
          ? -1 // serve-stale-while-revalidate sentinel
          : decoded.revalidate;
        return { ...metadata, revalidate, value: streamFromBuffer(body) };
      } catch {
        return undefined;
      }
    },

    async set(cacheKey, pendingEntry) {
      let resolvePending: (() => void) | undefined;
      pendingSets.set(
        cacheKey,
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
      );
      try {
        // Next 16.3 passes a Promise<CacheEntry> (value: plain stream once
        // resolved); the mirrored object shape wraps only the stream in a
        // promise. Awaiting both levels handles either.
        const entry = await pendingEntry;
        const stream = await entry.value;
        if (!stream) return;
        // The stream must always be fully drained - even when the write is
        // skipped - or Next's render stalls on the unread writer side.
        const body = await drainToBuffer(stream);
        // An expire of 0 marks a dynamic entry that is regenerated on every
        // read and never served back - persisting it would be a wasted write
        // (matches the built-in handler's production behavior).
        if (entry.expire === 0) return;
        const encoded = encodeEntry(entry, body);
        if (!encoded) return;
        await getClient().set(
          entryKey(cacheKey),
          encoded,
          clampTtlSeconds(entry.expire),
        );
      } catch {
        // drop the write - cache-down must never surface as an error
      } finally {
        resolvePending?.();
        pendingSets.delete(cacheKey);
      }
    },

    async refreshTags() {
      // Phase 1 no-op: get() reads tag records fresh on every call, so
      // correctness doesn't depend on a process-local manifest refresh.
    },

    async getExpiration(_tags) {
      // Infinity signals Next to pass soft tags into get() for checking
      // instead of using this timestamp (see get above).
      return Number.POSITIVE_INFINITY;
    },

    async updateTags(tags, durations) {
      try {
        await bumpTags(getClient(), tags, durations);
      } catch {
        // dropped invalidation on cache-down is safe: reads are misses too
      }
    },
  };
}

// Next.js loads `cacheHandlers.<kind>` via `interopDefault(await import(path))` -
// it expects the module's default export to be the handler instance itself,
// not a factory (see next/dist/server/next-server.js#loadCustomCacheHandlers).
export default createMemcachedCacheHandler();
