import type { CacheEntry } from "./types.js";

const ENVELOPE_VERSION = 1;

// memcached rejects items over ~1MB by default; leave headroom for the
// protocol line and JSON overhead.
const MAX_ENCODED_BYTES = 900 * 1024;

export interface DecodedEntry extends Omit<CacheEntry, "value"> {
  body: Buffer;
}

const debugWarn = (message: string): void => {
  if (process.env.NEXT_PRIVATE_DEBUG_CACHE) {
    console.warn(`nextjs-memcached-handler: ${message}`);
  }
};

/**
 * Encodes a cache entry as a self-describing JSON string. Returns undefined
 * (⇒ skip the write) when the encoded size exceeds the memcached item cap.
 */
export const encodeEntry = (
  entry: Omit<CacheEntry, "value">,
  body: Buffer,
): string | undefined => {
  const encoded = JSON.stringify({
    v: ENVELOPE_VERSION,
    tags: entry.tags,
    stale: entry.stale,
    timestamp: entry.timestamp,
    expire: entry.expire,
    revalidate: entry.revalidate,
    body: body.toString("base64"),
  });
  if (Buffer.byteLength(encoded) > MAX_ENCODED_BYTES) {
    debugWarn(`skipping oversized entry (${Buffer.byteLength(encoded)} bytes)`);
    return undefined;
  }
  return encoded;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Decodes an envelope produced by `encodeEntry`. Returns undefined (⇒ treated
 * as a miss) on any parse error, shape mismatch, or version mismatch — this
 * protects rolling deploys where pods run different envelope versions.
 */
export const decodeEntry = (raw: string): DecodedEntry | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.v !== ENVELOPE_VERSION) return undefined;
    if (!isStringArray(candidate.tags)) return undefined;
    if (typeof candidate.body !== "string") return undefined;
    const { stale, timestamp, expire, revalidate } = candidate;
    if (
      typeof stale !== "number" ||
      typeof timestamp !== "number" ||
      typeof expire !== "number" ||
      typeof revalidate !== "number"
    ) {
      return undefined;
    }
    return {
      tags: candidate.tags,
      stale,
      timestamp,
      expire,
      revalidate,
      body: Buffer.from(candidate.body, "base64"),
    };
  } catch {
    return undefined;
  }
};
