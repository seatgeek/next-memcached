/**
 * Integration suite against the memcached started from example/docker-compose.yml
 * (localhost:11211 — assumed running).
 */
import { describe, expect, it } from "vitest";
import { createMemcachedCacheHandler, entryKey } from "./index.js";
import { createClient } from "./memcached-client.js";
import { tagKey } from "./tags.js";
import type { CacheEntry } from "./types.js";

const handler = createMemcachedCacheHandler();
const inspector = createClient();

// Unique namespace per run so reruns never see each other's keys.
const runId = Math.random().toString(36).slice(2);
const key = (name: string) => `it-${runId}-${name}`;

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

// The shape Next 16.3 actually passes to set(): a Promise<CacheEntry>.
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

describe("set/get round trip", () => {
  it("returns identical body bytes and metadata, entry present in memcached", async () => {
    const cacheKey = key("round-trip");
    const meta = makeMeta();
    await handler.set(cacheKey, pendingEntryOf("hello memcached", meta));

    const entry = await handler.get(cacheKey, []);
    expect(entry).toBeDefined();
    expect(await readBody(entry as CacheEntry)).toBe("hello memcached");
    expect(entry?.tags).toEqual(meta.tags);
    expect(entry?.stale).toBe(meta.stale);
    expect(entry?.timestamp).toBe(meta.timestamp);
    expect(entry?.expire).toBe(meta.expire);
    expect(entry?.revalidate).toBe(meta.revalidate);

    // Verify it actually lives in memcached, not any in-process store.
    await expect(inspector.get(entryKey(cacheKey))).resolves.toBeTypeOf(
      "string",
    );
  });
});

describe("TTL expiry", () => {
  it("misses once now > timestamp + revalidate seconds", async () => {
    const cacheKey = key("ttl-expired");
    await handler.set(
      cacheKey,
      pendingEntryOf("stale", { timestamp: nowMs() - 10_000, revalidate: 5 }),
    );
    await expect(handler.get(cacheKey, [])).resolves.toBeUndefined();
  });
});

describe("hard tag invalidation", () => {
  it("misses after updateTags(tag) and hits again for entries set afterwards", async () => {
    const tag = key("tag-hard");
    // Seed the tag record so the cold-tag fail-safe doesn't shadow this test.
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

describe("soft tag invalidation", () => {
  it("serves the entry with revalidate -1, and entries set afterwards normally", async () => {
    const tag = key("tag-soft");
    await handler.updateTags([tag]);
    await sleep(5);

    const cacheKey = key("soft");
    await handler.set(cacheKey, pendingEntryOf("v1", { tags: [tag] }));
    expect((await handler.get(cacheKey, []))?.revalidate).toBe(300);

    await handler.updateTags([tag], { expire: 31_536_000 }); // revalidateTag(tag, 'max')
    const staleServed = await handler.get(cacheKey, []);
    expect(staleServed).toBeDefined();
    expect(staleServed?.revalidate).toBe(-1);
    expect(await readBody(staleServed as CacheEntry)).toBe("v1");

    await sleep(5);
    await handler.set(cacheKey, pendingEntryOf("v2", { tags: [tag] }));
    const fresh = await handler.get(cacheKey, []);
    expect(fresh?.revalidate).toBe(300);
    expect(await readBody(fresh as CacheEntry)).toBe("v2");
  });
});

describe("fail-safe re-seed on missing tag records", () => {
  it("misses once when an entry tag's record was evicted, then self-heals", async () => {
    const tag = key("tag-evicted");
    await handler.updateTags([tag]);
    await sleep(5);

    const cacheKey = key("failsafe");
    await handler.set(cacheKey, pendingEntryOf("v1", { tags: [tag] }));
    expect(await handler.get(cacheKey, [])).toBeDefined();

    // Simulate LRU eviction of the tag record.
    await expect(inspector.delete(tagKey(tag))).resolves.toBe(true);
    await expect(handler.get(cacheKey, [])).resolves.toBeUndefined();

    // Let the fire-and-forget re-seed land, then write a fresh entry — it
    // must hit (no permanent miss loop).
    await sleep(100);
    await handler.set(cacheKey, pendingEntryOf("v2", { tags: [tag] }));
    expect(
      await readBody((await handler.get(cacheKey, [])) as CacheEntry),
    ).toBe("v2");
  });

  it("self-heals for soft (implicit) tags passed to get()", async () => {
    const softTag = key("_N_T_/route");
    const cacheKey = key("softtag-failsafe");
    await handler.set(cacheKey, pendingEntryOf("v1"));

    // First read with a never-seen soft tag: fail-safe miss + re-seed.
    await expect(handler.get(cacheKey, [softTag])).resolves.toBeUndefined();

    // A set→get cycle after the re-seed must hit — the re-seeded record must
    // not keep expiring newer entries.
    await sleep(100);
    await handler.set(cacheKey, pendingEntryOf("v2"));
    const entry = await handler.get(cacheKey, [softTag]);
    expect(entry).toBeDefined();
    expect(await readBody(entry as CacheEntry)).toBe("v2");
  });
});

describe("cache down", () => {
  it("all methods resolve safely and fast against an unreachable memcached", async () => {
    const deadHandler = createMemcachedCacheHandler({ uri: "localhost:19999" });
    const started = Date.now();
    await expect(
      deadHandler.get(key("dead"), ["tag"]),
    ).resolves.toBeUndefined();
    await expect(
      deadHandler.set(key("dead"), pendingEntryOf("x", { tags: ["tag"] })),
    ).resolves.toBeUndefined();
    await expect(deadHandler.updateTags(["tag"])).resolves.toBeUndefined();
    await expect(
      deadHandler.updateTags(["tag"], { expire: 60 }),
    ).resolves.toBeUndefined();
    await expect(deadHandler.refreshTags()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("dynamic entries (expire === 0)", () => {
  it("drains the stream but never persists", async () => {
    const cacheKey = key("dynamic");
    // Pull-based source: chunks are only produced when something reads the
    // stream, so pull counts prove set() drained it despite skipping the write.
    let pulls = 0;
    const value = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode("dynamic"));
        } else {
          controller.close();
        }
      },
    });
    await handler.set(
      cacheKey,
      Promise.resolve({ ...makeMeta({ expire: 0 }), value }),
    );
    expect(pulls).toBeGreaterThanOrEqual(2); // read to completion, not abandoned
    await expect(inspector.get(entryKey(cacheKey))).resolves.toBeUndefined();
    await expect(handler.get(cacheKey, [])).resolves.toBeUndefined();
  });
});

describe("defensive guards", () => {
  it("a corrupted envelope in memcached reads as a miss", async () => {
    const cacheKey = key("corrupt-envelope");
    await inspector.set(entryKey(cacheKey), "not a valid envelope", 60);
    await expect(handler.get(cacheKey, [])).resolves.toBeUndefined();
  });

  it("a malformed tag record reads as expired (fail-safe miss)", async () => {
    const tag = key("tag-corrupt");
    const cacheKey = key("corrupt-tag");
    await handler.set(cacheKey, pendingEntryOf("v1", { tags: [tag] }));
    await inspector.set(tagKey(tag), "not json", 60);
    await expect(handler.get(cacheKey, [])).resolves.toBeUndefined();
  });

  it("set() without a stream is a safe no-op", async () => {
    const cacheKey = key("no-stream");
    await expect(
      handler.set(
        cacheKey,
        Promise.resolve({
          ...makeMeta(),
          value: undefined as unknown as ReadableStream<Uint8Array>,
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(inspector.get(entryKey(cacheKey))).resolves.toBeUndefined();
  });

  it("set() drains but skips bodies over the memcached item cap", async () => {
    const cacheKey = key("oversized");
    await handler.set(cacheKey, pendingEntryOf("x".repeat(1024 * 1024)));
    await expect(inspector.get(entryKey(cacheKey))).resolves.toBeUndefined();
  });

  it("a non-finite expire clamps to the max TTL and still persists", async () => {
    const cacheKey = key("infinite-expire");
    await handler.set(
      cacheKey,
      pendingEntryOf("forever-ish", { expire: Number.POSITIVE_INFINITY }),
    );
    await expect(inspector.get(entryKey(cacheKey))).resolves.toBeTypeOf(
      "string",
    );
  });
});

describe("getExpiration", () => {
  it("returns Infinity (soft tags are checked in get())", async () => {
    await expect(handler.getExpiration(["tag-a", "tag-b"])).resolves.toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});
