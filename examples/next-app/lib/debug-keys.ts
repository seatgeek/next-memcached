/**
 * Response contract of /api/debug/keys - the single source of truth shared by
 * the route (producer), the debug panel (browser consumer), and the e2e
 * suite (type-only import). Deliberately dependency-free so any tsconfig can
 * type-check against it.
 */

export interface DebugKey {
  key: string;
  sizeBytes: number;
  /** Unix expiry seconds, -1 = never. */
  exp: number;
  /** Seconds until expiry, null when exp is -1/unknown. */
  ttlSeconds: number | null;
  kind: "entry" | "tag" | "other";
  /** Envelope metadata, when the value decodes as the handler's envelope. */
  tags?: string[];
  /** Entries: envelope timestamp. Tag records: the `expired` timestamp. */
  cachedAt?: number;
  stale?: number;
  revalidate?: number;
  expire?: number;
  valuePreview?: string;
}

export interface DebugKeysResponse {
  target: string;
  source: "metadump" | "cachedump" | null;
  count: number;
  truncated: boolean;
  keys: DebugKey[];
  error: string | null;
}
