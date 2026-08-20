import { createHash } from "node:crypto";
import type {
  DebugKey,
  DebugKeysResponse,
} from "../examples/next-app/lib/debug-keys";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
export const MODE = process.env.E2E_MODE ?? "plain";

/**
 * Registry of every fragment the example app renders on "/" without a
 * session cookie, with its declared tags (mirrors fragments.tsx). Tests
 * DERIVE moved/frozen partitions from this instead of hand-listing them,
 * so a new fragment is covered by every tag scenario automatically.
 *
 * `short` marks the 5s-stale profile: those fragments may legitimately
 * refresh mid-test, so "stays frozen" is only ever asserted on the others.
 */
export const FRAGMENTS: Record<string, { tags: string[]; short?: boolean }> = {
  "public-content": { tags: ["public"] },
  "entry-demo-1": { tags: ["entry:demo-1"] },
  "short-tag-a": { tags: ["tag-a"], short: true },
  "short-tag-b": { tags: ["tag-b"], short: true },
  "long-tag-a": { tags: ["tag-a"] },
  "multi-tag-abc": { tags: ["tag-a", "tag-b", "tag-c"] },
  "shared-tag-c": { tags: ["tag-c"] },
  "default-no-tag": { tags: [] },
  verylong: { tags: [] },
};

export const fragmentNames = Object.keys(FRAGMENTS);

export const carriersOf = (tag: string): string[] =>
  fragmentNames.filter((name) => FRAGMENTS[name].tags.includes(tag));

/** Fragments whose frozen-ness is safe to assert (not on the 5s profile). */
export const frozenComparable = (excluded: string[]): string[] =>
  fragmentNames.filter(
    (name) => !FRAGMENTS[name].short && !excluded.includes(name),
  );

/** Value accessor that fails loudly instead of letting a missing fragment
 * satisfy `.not.toBe` vacuously (undefined !== anything). */
export const frag = (map: Map<string, string>, name: string): string => {
  const value = map.get(name);
  if (value === undefined) {
    throw new Error(
      `fragment "${name}" not found on the page (got: ${[...map.keys()].join(", ") || "none"})`,
    );
  }
  return value;
};

/**
 * Fetch a page and parse every element carrying both `data-cache-fragment`
 * and `data-cache-value`, extracting each attribute independently - no
 * assumption about their order or adjacency within the tag.
 */
export const fetchPage = async (
  pathname = "/",
): Promise<Map<string, string>> => {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    headers: { accept: "text/html" },
  });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`);
  const html = await res.text();

  const fragments = new Map<string, string>();
  for (const [tag] of html.matchAll(/<[^>]*\bdata-cache-fragment="[^>]*>/g)) {
    const name = tag.match(/\bdata-cache-fragment="([^"]+)"/)?.[1];
    const value = tag.match(/\bdata-cache-value="([^"]+)"/)?.[1];
    if (name && value) fragments.set(name, value);
  }
  return fragments;
};

/**
 * Ground truth via the app's raw-socket inspector (/api/debug/keys): what is
 * PHYSICALLY in memcached, enumerated by the same process and connection
 * config the handler uses - independent of the handler package itself.
 */
export const debugKeys = async (): Promise<DebugKeysResponse> => {
  const res = await fetch(`${BASE_URL}/api/debug/keys`);
  if (!res.ok) throw new Error(`debug/keys -> ${res.status}`);
  const body = (await res.json()) as DebugKeysResponse;
  if (body.error) throw new Error(`debug/keys -> ${body.error}`);
  return body;
};

/**
 * Read a tag's version record straight from memcached. Tag keys are
 * `t:<sha1(tag)>` (src/tags.ts); the debug route surfaces the record's
 * `expired` timestamp as `cachedAt` and `stale` as `stale`.
 */
export const tagRecord = async (
  tag: string,
): Promise<{ expired?: number; stale?: number } | undefined> => {
  const key = `t:${createHash("sha1").update(tag).digest("hex")}`;
  const found: DebugKey | undefined = (await debugKeys()).keys.find(
    (k) => k.key === key,
  );
  return found ? { expired: found.cachedAt, stale: found.stale } : undefined;
};

export const invalidate = async (
  tag: string,
  mode: "hard" | "soft",
): Promise<void> => {
  const res = await fetch(
    `${BASE_URL}/api/invalidate?tag=${encodeURIComponent(tag)}&mode=${mode}`,
  );
  if (!res.ok) throw new Error(`invalidate ${tag} ${mode} -> ${res.status}`);
};

export const revalidatePath = async (pathname: string): Promise<void> => {
  const res = await fetch(
    `${BASE_URL}/api/revalidate-path?path=${encodeURIComponent(pathname)}`,
  );
  if (!res.ok) throw new Error(`revalidate-path -> ${res.status}`);
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Populate-then-confirm: the first fetch renders (and stores) anything
 * missing or busted by the previous test; the second returns values proven
 * to come from cache - the stable baseline. Both fetches are load-bearing.
 */
export const warm = async (): Promise<Map<string, string>> => {
  await fetchPage("/");
  return fetchPage("/");
};
