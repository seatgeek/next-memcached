import { createHash } from "node:crypto";
import type { Memcache } from "memcache";

/**
 * One tiny record per tag, mirroring the shape of Next's built-in
 * tags-manifest (`dist/server/lib/incremental-cache/tags-manifest.external.js`):
 * `expired`/`stale` are absolute millisecond timestamps.
 */
export interface TagRecord {
  expired?: number;
  stale?: number;
}

// memcached's max relative TTL (30 days). Tag-record eviction before then is
// handled by the fail-safe re-seed in readTagRecords, not by TTL avoidance.
export const TAG_RECORD_TTL_SECONDS = 2_592_000;

export const sha1hex = (value: string): string =>
  createHash("sha1").update(value).digest("hex");

export const tagKey = (tag: string): string => `t:${sha1hex(tag)}`;

const nowMs = (): number => performance.timeOrigin + performance.now();

const parseTagRecord = (raw: string | undefined): TagRecord | undefined => {
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { expired, stale } = parsed as Record<string, unknown>;
    if (expired !== undefined && typeof expired !== "number") return undefined;
    if (stale !== undefined && typeof stale !== "number") return undefined;
    return { expired, stale } as TagRecord;
  } catch {
    return undefined;
  }
};

/**
 * Reads the records for the given tags in one batched multi-get.
 *
 * Fail-safe: a tag with no record (evicted, or never seen) is treated as
 * `{expired: now}` for this read — an evicted record may have carried a lost
 * invalidation, so it must read as "just invalidated", never as "never
 * invalidated". The record is re-seeded fire-and-forget via `add` (not `set`)
 * so a concurrent real updateTags write wins. Entries written after the
 * re-seed have `timestamp > expired` and survive — one extra miss per cold
 * tag, then self-healed.
 */
export const readTagRecords = async (
  client: Memcache,
  tags: string[],
): Promise<Map<string, TagRecord>> => {
  if (tags.length === 0) return new Map();
  const keys = tags.map(tagKey);
  const raw = await client.gets(keys);
  const now = nowMs();
  return new Map(
    tags.map((tag, index) => {
      const record = parseTagRecord(raw.get(keys[index]));
      if (record) return [tag, record];
      void client
        .add(
          keys[index],
          JSON.stringify({ expired: now }),
          TAG_RECORD_TTL_SECONDS,
        )
        .catch(() => {});
      return [tag, { expired: now }];
    }),
  );
};

/** Mirrors `areTagsExpired` from tags-manifest.external.js for one record. */
export const isHardExpired = (
  record: TagRecord,
  entryTimestamp: number,
  now: number,
): boolean =>
  typeof record.expired === "number" &&
  record.expired <= now &&
  record.expired > entryTimestamp;

/** Mirrors `areTagsStale` from tags-manifest.external.js for one record. */
export const isSoftStale = (
  record: TagRecord,
  entryTimestamp: number,
): boolean => typeof record.stale === "number" && record.stale > entryTimestamp;

/**
 * Write side of `updateTags`, mirroring the built-in handler exactly:
 * no durations ⇒ hard (`expired = now`); with durations ⇒ soft
 * (`stale = now`, plus `expired = now + durations.expire * 1000` when given).
 * Read-modify-write: existing fields not being updated are preserved.
 */
export const bumpTags = async (
  client: Memcache,
  tags: string[],
  durations?: { expire?: number },
): Promise<void> => {
  if (tags.length === 0) return;
  const keys = tags.map(tagKey);
  const existing = await client.gets(keys);
  const now = Math.round(nowMs());
  await Promise.all(
    tags.map((_tag, index) => {
      const record = parseTagRecord(existing.get(keys[index])) ?? {};
      const updated: TagRecord = durations
        ? {
            ...record,
            stale: now,
            ...(durations.expire !== undefined
              ? { expired: now + durations.expire * 1000 }
              : {}),
          }
        : { ...record, expired: now };
      return client.set(
        keys[index],
        JSON.stringify(updated),
        TAG_RECORD_TTL_SECONDS,
      );
    }),
  );
};
