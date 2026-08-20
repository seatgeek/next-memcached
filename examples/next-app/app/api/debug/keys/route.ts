import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import type { DebugKey } from "@/lib/debug-keys";
import {
  inspectGetMany,
  listKeys,
  parseMemcachedUri,
} from "@/lib/memcached-inspector";

/**
 * GET /api/debug/keys
 *
 * Enumerates ALL keys currently in memcached over a raw TCP socket (no
 * driver, no handler package - independent proof that `'use cache'` entries
 * persist in the shared cache rather than an in-process LRU). For each key
 * the value is fetched and, when it parses as the handler's envelope JSON
 * ({v:1, tags, timestamp, ...}), the decoded metadata is included.
 *
 * Local demo only - deliberately unauthenticated.
 */

const MAX_VALUES_FETCHED = 200;

export async function GET() {
  const uri = process.env.MEMCACHED_URI ?? "localhost:11211";
  const { host, port } = parseMemcachedUri(uri);
  // memcaches:// targets (e.g. the TLS serverless-sim) need a TLS socket;
  // MEMCACHED_TLS_CA points at the CA bundle, same as the handler.
  const secure = /^memcaches:\/\//i.test(uri);
  const caPath = process.env.MEMCACHED_TLS_CA;
  const opts = {
    host,
    port,
    timeoutMs: 2000,
    ...(secure
      ? { tls: true, ...(caPath ? { caFile: readFileSync(caPath) } : {}) }
      : {}),
  };

  try {
    const listing = await listKeys(opts);
    const nowSeconds = Math.floor(Date.now() / 1000);

    const inspected = listing.keys.slice(0, MAX_VALUES_FETCHED);
    const values = await inspectGetMany(
      opts,
      inspected.map((meta) => meta.key),
    ).catch(() => new Map<string, string>());

    const keys: DebugKey[] = inspected.map((meta) => {
      const base: DebugKey = {
        key: meta.key,
        sizeBytes: meta.size,
        exp: meta.exp,
        ttlSeconds: meta.exp > 0 ? meta.exp - nowSeconds : null,
        kind: "other",
      };
      const raw = values.get(meta.key);
      if (raw === undefined) return base;
      return { ...base, ...describeValue(raw) };
    });

    return NextResponse.json({
      target: `${host}:${port}`,
      source: listing.source,
      count: listing.keys.length,
      truncated: listing.keys.length > MAX_VALUES_FETCHED,
      keys,
      error: null,
    });
  } catch (err) {
    return NextResponse.json({
      target: `${host}:${port}`,
      source: null,
      count: 0,
      truncated: false,
      keys: [],
      error: (err as Error).message,
    });
  }
}

function describeValue(raw: string): Partial<DebugKey> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valuePreview: preview(raw) };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { valuePreview: preview(raw) };
  }
  const record = parsed as Record<string, unknown>;

  // Handler envelope: {v: 1, tags, timestamp, stale, revalidate, expire, body}
  if (record.v === 1 && typeof record.timestamp === "number") {
    return {
      kind: "entry",
      tags: Array.isArray(record.tags) ? record.tags.map(String) : [],
      cachedAt: record.timestamp,
      stale: numberOrUndefined(record.stale),
      revalidate: numberOrUndefined(record.revalidate),
      expire: numberOrUndefined(record.expire),
    };
  }

  // Tag version record: {expired?, stale?} timestamps.
  if ("expired" in record || "stale" in record) {
    return {
      kind: "tag",
      cachedAt: numberOrUndefined(record.expired),
      stale: numberOrUndefined(record.stale),
      valuePreview: preview(raw),
    };
  }

  return { valuePreview: preview(raw) };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function preview(raw: string): string {
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}
