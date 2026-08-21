import { describe, expect, it } from "vitest";
import type { DebugKeysResponse } from "../examples/next-app/lib/debug-keys";
import {
  carriersOf,
  debugKeys,
  FRAGMENTS,
  fetchPage,
  frag,
  fragmentNames,
  frozenComparable,
  invalidate,
  MODE,
  revalidatePath,
  tagRecord,
  warm,
} from "./helpers";

const POLL = { interval: 1_000, timeout: 15_000 };

/**
 * End-to-end cache semantics against a real `next start` of the example app
 * (booted by global-setup) over live memcached (plain or TLS per E2E_MODE).
 * Fragment values embed Date.now() + randomness, so "value unchanged across
 * requests" IS the proof of a cache hit and "value changed" of a miss. The
 * app sets cacheMaxMemorySize: 0, so a frozen value proves a memcached
 * round trip, not an in-process LRU hit.
 *
 * The fragment/tag topology lives in FRAGMENTS (e2e/helpers.ts, mirroring
 * examples/next-app/app/fragments.tsx); moved/frozen partitions are derived
 * from it, so tag scenarios automatically cover every registered fragment.
 */
describe(`e2e cache semantics (${MODE})`, () => {
  /** Invalidate a tag hard; carriers must move, every stable non-carrier
   * must stay frozen (short-profile fragments are exempt from frozen checks
   * - their 5s stale window can elapse mid-test). */
  const expectHardInvalidation = async (tag: string) => {
    const carriers = carriersOf(tag);
    expect(carriers.length).toBeGreaterThan(0);
    const before = await warm();
    await invalidate(tag, "hard");
    const after = await fetchPage("/");
    for (const name of carriers) {
      expect(frag(after, name), `${name} (carries ${tag})`).not.toBe(
        frag(before, name),
      );
    }
    for (const name of frozenComparable(carriers)) {
      expect(frag(after, name), `${name} (must stay frozen)`).toBe(
        frag(before, name),
      );
    }
  };

  it("serves cache hits: every fragment present and frozen across requests", async () => {
    const warm1 = await warm();
    const warm2 = await fetchPage("/");
    for (const name of fragmentNames) {
      expect(frag(warm2, name), name).toBe(frag(warm1, name));
    }
  });

  it("stores entries in memcached, not an in-process cache (key inspection)", async () => {
    // The frozen values above only prove caching happened SOMEWHERE. This
    // enumerates memcached's actual keyspace over a raw socket (via the
    // app's /api/debug/keys, so URI/TLS config is guaranteed consistent
    // with the handler's) and asserts the fragments physically landed as
    // envelope entries with their declared tags, alongside tag records.
    await warm();
    // `set`s happen after the response is flushed (and each costs a TLS
    // round trip in memcaches:// mode), so the keyspace converges shortly
    // AFTER warm() returns - poll until every fragment's tag set is
    // physically present instead of snapshotting an instant (a bare entry
    // COUNT can be satisfied early by leftovers from previous tests).
    const covered = (r: DebugKeysResponse): boolean => {
      const entries = r.keys.filter((k) => k.kind === "entry");
      return (
        entries.length >= fragmentNames.length &&
        Object.values(FRAGMENTS).every(
          ({ tags }) =>
            tags.length === 0 ||
            entries.some((e) => tags.every((t) => e.tags?.includes(t))),
        )
      );
    };
    // Keep the snapshot that satisfied the poll: metadump enumeration is
    // itself slightly racy, so a separate re-read could transiently miss a
    // key the poll already proved present.
    let inspection!: DebugKeysResponse;
    await expect
      .poll(async () => {
        inspection = await debugKeys();
        return inspection;
      }, POLL)
      .toSatisfy(covered, "every fragment's entry visible in memcached");
    // The route only decodes the first 200 keys; a long-lived local
    // memcached full of leftovers makes this test meaningless - fail with
    // the remedy rather than flaking on arbitrary enumeration order.
    expect(
      inspection.truncated,
      "keyspace exceeds the inspector's decode cap — restart services (`make services-stop && make services`) for a clean run",
    ).toBe(false);

    const entries = inspection.keys.filter((k) => k.kind === "entry");
    for (const [name, { tags }] of Object.entries(FRAGMENTS)) {
      if (tags.length === 0) continue;
      expect(
        entries.some((e) => tags.every((t) => e.tags?.includes(t))),
        `entry carrying ${tags.join("+")} (${name}) present in memcached`,
      ).toBe(true);
    }
    expect(inspection.keys.some((k) => k.kind === "tag")).toBe(true);
  });

  it("expires short-TTL entries while long-TTL entries stay frozen", async () => {
    const before = await warm();
    // short profile: expire 10s. Poll until the entry rolls over rather
    // than sleeping a fixed worst case.
    await expect
      .poll(async () => (await fetchPage("/")).get("short-tag-a"), {
        interval: 2_000,
        timeout: 15_000,
      })
      .not.toBe(frag(before, "short-tag-a"));
    const after = await fetchPage("/");
    for (const name of frozenComparable([])) {
      expect(frag(after, name), `${name} (must survive short expiry)`).toBe(
        frag(before, name),
      );
    }
  });

  it("hard tag invalidation busts every carrier of tag-b, nothing else", () =>
    expectHardInvalidation("tag-b"));

  it("hard tag invalidation of shared tag-c moves all its carriers", () =>
    expectHardInvalidation("tag-c"));

  it("soft invalidation marks tags stale (not expired), then refreshes", async () => {
    const before = await warm();
    // The record is (re-)seeded asynchronously after the warm reads flush
    // their responses, and metadump enumeration is itself slightly racy -
    // poll for the record and keep the snapshot that satisfied the poll
    // (a separate re-read could transiently miss it again).
    let recordBefore!: Awaited<ReturnType<typeof tagRecord>>;
    await expect
      .poll(async () => {
        recordBefore = await tagRecord("tag-a");
        return recordBefore;
      }, POLL)
      .toBeDefined();

    await invalidate("tag-a", "soft");

    // The SWR part, asserted on the tag record itself (src/tags.ts
    // semantics): `stale` must move to now, while `expired` must NOT become
    // an immediate expiry - hard invalidation sets expired = now; soft
    // leaves it alone or pushes it into the future (revalidateTag(tag,
    // 'max') sets stale = now plus a far-future expire). If soft ever
    // degrades into hard, `expired` lands at ~now and this fails.
    let recordAfter!: Awaited<ReturnType<typeof tagRecord>>;
    await expect
      .poll(async () => {
        recordAfter = await tagRecord("tag-a");
        return recordAfter?.stale ?? 0;
      }, POLL)
      .toBeGreaterThan(recordBefore?.stale ?? 0);
    expect(recordAfter?.expired ?? Number.POSITIVE_INFINITY).toBeGreaterThan(
      Date.now() + 5_000,
    );

    // Eventual refresh: the entry re-renders within a few requests (the
    // first may serve stale one last time, by design).
    await expect
      .poll(async () => (await fetchPage("/")).get("long-tag-a"), POLL)
      .not.toBe(frag(before, "long-tag-a"));
    const after = await fetchPage("/");
    expect(frag(after, "verylong")).toBe(frag(before, "verylong"));
  });

  it("path revalidation busts every fragment on the page", async () => {
    const before = await warm();
    await revalidatePath("/");
    const after = await fetchPage("/");
    for (const name of fragmentNames) {
      expect(frag(after, name), name).not.toBe(frag(before, name));
    }
  });
});
