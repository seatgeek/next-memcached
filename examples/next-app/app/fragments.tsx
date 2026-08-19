import { cacheLife, cacheTag } from "next/cache";

function randomValue() {
  return Math.random().toString(36).slice(2);
}

const palette = {
  text: "#181818",
  muted: "#767575",
  border: "#DEDDDB",
  panel: "#F5F5F4",
  fresh: "#11A669",
};

/**
 * Presentational shell for a cached fragment. All props are computed INSIDE
 * the `'use cache'` function that renders it, so `cachedAt` is the moment the
 * cached value was produced — on a cache hit it stays frozen, which is the
 * visual proof of caching.
 *
 * Attribute order matters: the e2e harness greps for
 * `data-cache-fragment="…" data-cache-value="…"` adjacent, in that order.
 */
function Stamp(props: {
  fragment: string;
  value: string;
  cachedAt: number;
  label: string;
  profile: string;
  tags?: string[];
}) {
  const iso = new Date(props.cachedAt).toISOString().replace("T", " ");
  return (
    <span
      data-cache-fragment={props.fragment}
      data-cache-value={props.value}
      data-cached-at={props.cachedAt}
      style={{
        display: "block",
        padding: "8px 12px",
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        background: palette.panel,
        color: palette.text,
        fontFamily: "ui-monospace, monospace",
        fontSize: 13,
      }}
    >
      <strong>{props.label}</strong>{" "}
      <span style={{ color: palette.muted }}>
        [{props.profile}
        {props.tags?.length ? ` · tags: ${props.tags.join(", ")}` : ""}]
      </span>
      <br />
      value: {props.value}
      <br />
      cached at: <span style={{ color: palette.fresh }}>{iso} UTC</span>
    </span>
  );
}

/**
 * Each fragment below is intentionally its own `'use cache'` boundary,
 * tagged and profiled distinctly, so the acceptance harness can address
 * exactly one axis (a single tag, a single TTL profile) per assertion
 * without cross-contamination from the others.
 */

export async function ShortTtlTagA() {
  "use cache";
  cacheLife("short");
  cacheTag("tag-a");
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="short-tag-a"
      value={`${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label="ShortTtlTagA"
      profile="short: stale 5s / revalidate 5s / expire 10s"
      tags={["tag-a"]}
    />
  );
}

export async function ShortTtlTagB() {
  "use cache";
  cacheLife("short");
  cacheTag("tag-b");
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="short-tag-b"
      value={`${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label="ShortTtlTagB"
      profile="short: stale 5s / revalidate 5s / expire 10s"
      tags={["tag-b"]}
    />
  );
}

export async function LongTtlTagA() {
  "use cache";
  cacheLife("long");
  cacheTag("tag-a");
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="long-tag-a"
      value={`${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label="LongTtlTagA"
      profile="long: stale 5m / revalidate 5m / expire 10m"
      tags={["tag-a"]}
    />
  );
}

export async function DefaultProfileNoTag() {
  "use cache";
  cacheLife("default");
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="default-no-tag"
      value={`${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label="DefaultProfileNoTag"
      profile="default profile"
    />
  );
}

/** Section 1: identical for every visitor — no cookie/session dependency. */
export async function PublicContent() {
  "use cache";
  cacheLife("long");
  cacheTag("public");
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="public-content"
      value={`${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label="PublicContent"
      profile="long: stale 5m / revalidate 5m / expire 10m"
      tags={["public"]}
    />
  );
}

/**
 * Section 2: per-browser-session content. The session id arrives as an
 * ARGUMENT, so `'use cache'` includes it in the cache key automatically —
 * two browsers (or incognito windows) each get their own frozen timestamp.
 */
export async function PrivateContent({ sessionId }: { sessionId: string }) {
  "use cache";
  cacheLife("long");
  cacheTag(`session:${sessionId}`);
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="private-session"
      value={`${sessionId}:${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label={`PrivateContent (session ${sessionId})`}
      profile="long: stale 5m / revalidate 5m / expire 10m"
      tags={[`session:${sessionId}`]}
    />
  );
}

/**
 * Section 3a: carries its own unique per-entry tag so the "invalidate this
 * entry" button can target exactly this fragment. Next.js has no key-level
 * invalidation API — a one-entry tag is the idiomatic equivalent.
 */
export async function EntryDemo() {
  "use cache";
  cacheLife("long");
  cacheTag("entry:demo-1");
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="entry-demo-1"
      value={`${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label="EntryDemo"
      profile="long: stale 5m / revalidate 5m / expire 10m"
      tags={["entry:demo-1"]}
    />
  );
}

/** Section 3c: long-running cache — only tag/path invalidation moves it. */
export async function VeryLongTtl() {
  "use cache";
  cacheLife("verylong");
  const cachedAt = Date.now();
  return (
    <Stamp
      fragment="verylong"
      value={`${cachedAt}-${randomValue()}`}
      cachedAt={cachedAt}
      label="VeryLongTtl"
      profile="verylong: stale 1h / revalidate 1h / expire 24h"
    />
  );
}
