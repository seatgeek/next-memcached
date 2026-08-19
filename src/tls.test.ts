/**
 * TLS integration suite against the serverless-sim memcached started from
 * this repo's docker-compose.yml (memcached-tls, TLS-only on localhost:21211,
 * certs under certs/ — assumed running).
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createMemcachedCacheHandler, entryKey } from "./index.js";
import { createClient } from "./memcached-client.js";
import type { CacheEntry } from "./types.js";

const TLS_URI = "memcaches://localhost:21211";
const CA_PATH = fileURLToPath(new URL("../certs/cacert.pem", import.meta.url));
// A valid PEM that is NOT the signer of the server's certificate — TLS
// verification must fail, and the handler must degrade to cache-down.
const WRONG_CA_PATH = fileURLToPath(
  new URL("../certs/server_crt.pem", import.meta.url),
);

// The client reads MEMCACHED_TLS_CA lazily on first use; pin the good CA for
// every client created in this file unless a test overrides it.
process.env.MEMCACHED_TLS_CA = CA_PATH;

/** Run `fn` with MEMCACHED_TLS_CA temporarily pointed at `caPath`. */
const withCa = async <T>(caPath: string, fn: () => Promise<T>): Promise<T> => {
  const previous = process.env.MEMCACHED_TLS_CA;
  process.env.MEMCACHED_TLS_CA = caPath;
  try {
    return await fn();
  } finally {
    process.env.MEMCACHED_TLS_CA = previous;
  }
};

const handler = createMemcachedCacheHandler({ uri: TLS_URI });
const inspector = createClient(TLS_URI);

// Unique namespace per run so reruns never see each other's keys.
const runId = Math.random().toString(36).slice(2);
const key = (name: string) => `tls-${runId}-${name}`;

const nowMs = () => performance.timeOrigin + performance.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const makeMeta = (overrides: Partial<Omit<CacheEntry, "value">> = {}) => ({
  tags: [] as string[],
  stale: 60,
  timestamp: nowMs(),
  expire: 300,
  revalidate: 300,
  ...overrides,
});

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

const pendingEntryOf = (
  text: string,
  overrides: Partial<Omit<CacheEntry, "value">> = {},
): Promise<CacheEntry> =>
  Promise.resolve({ ...makeMeta(overrides), value: streamOf(text) });

const readBody = async (entry: CacheEntry): Promise<string> => {
  const chunks: Uint8Array[] = [];
  const reader = entry.value.getReader();
  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  ) {
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

describe("TLS set/get round trip", () => {
  it("returns identical body bytes and metadata, entry present in memcached", async () => {
    const cacheKey = key("round-trip");
    const meta = makeMeta();
    await handler.set(cacheKey, pendingEntryOf("hello tls memcached", meta));

    const entry = await handler.get(cacheKey, []);
    expect(entry).toBeDefined();
    expect(await readBody(entry as CacheEntry)).toBe("hello tls memcached");
    expect(entry?.tags).toEqual(meta.tags);
    expect(entry?.timestamp).toBe(meta.timestamp);

    // Verify it actually lives in the TLS memcached, not any in-process store.
    await expect(inspector.get(entryKey(cacheKey))).resolves.toBeTypeOf(
      "string",
    );
  });
});

describe("TLS hard tag invalidation", () => {
  it("misses after updateTags(tag) and hits again for entries set afterwards", async () => {
    const tag = key("tag-hard");
    await handler.updateTags([tag]);
    await sleep(5);

    const cacheKey = key("hard");
    await handler.set(cacheKey, pendingEntryOf("v1", { tags: [tag] }));
    expect(
      await readBody((await handler.get(cacheKey, [])) as CacheEntry),
    ).toBe("v1");

    await handler.updateTags([tag]); // hard: no durations ⇒ expired = now
    await expect(handler.get(cacheKey, [])).resolves.toBeUndefined();

    await sleep(5);
    await handler.set(cacheKey, pendingEntryOf("v2", { tags: [tag] }));
    expect(
      await readBody((await handler.get(cacheKey, [])) as CacheEntry),
    ).toBe("v2");
  });
});

describe("TLS cache down (handshake failure)", () => {
  it("all methods resolve safely against the TLS port with the wrong CA", async () => {
    await withCa(WRONG_CA_PATH, async () => {
      const deadHandler = createMemcachedCacheHandler({ uri: TLS_URI });
      const started = Date.now();
      await expect(
        deadHandler.get(key("dead"), ["tag"]),
      ).resolves.toBeUndefined();
      await expect(
        deadHandler.set(key("dead"), pendingEntryOf("x", { tags: ["tag"] })),
      ).resolves.toBeUndefined();
      await expect(deadHandler.updateTags(["tag"])).resolves.toBeUndefined();
      await expect(deadHandler.refreshTags()).resolves.toBeUndefined();
      expect(Date.now() - started).toBeLessThan(4_000);
    });
  });
});
