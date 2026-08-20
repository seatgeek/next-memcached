import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActionButton, RefreshButton } from "./controls";
import { DebugPanel } from "./debug-panel";
import {
  DefaultProfileNoTag,
  EntryDemo,
  LongTtlTagA,
  MultiTagABC,
  PrivateContent,
  PublicContent,
  SharedTagC,
  ShortTtlTagA,
  ShortTtlTagB,
  VeryLongTtl,
} from "./fragments";

const palette = {
  text: "#181818",
  muted: "#767575",
  border: "#DEDDDB",
  blue: "#1C71EF",
};

function Section(props: {
  title: string;
  children: React.ReactNode;
  intro?: React.ReactNode;
}) {
  return (
    <section
      style={{
        marginBottom: 32,
        paddingBottom: 24,
        borderBottom: `1px solid ${palette.border}`,
      }}
    >
      <h2 style={{ fontSize: 18, color: palette.blue, marginBottom: 4 }}>
        {props.title}
      </h2>
      {props.intro && (
        <p style={{ color: palette.muted, fontSize: 13, marginTop: 0 }}>
          {props.intro}
        </p>
      )}
      {props.children}
    </section>
  );
}

/**
 * Reads the session cookie OUTSIDE any cached function (cookies() is a
 * dynamic API - allowed in the page's dynamic shell, never inside
 * `'use cache'`). The id is then passed as an argument into PrivateContent,
 * making it part of that fragment's cache key.
 */
async function PrivateSection() {
  const jar = await cookies();
  const sessionId = jar.get("demo-session")?.value;

  if (!sessionId) {
    return (
      <p>
        No session yet —{" "}
        <a href="/api/session" style={{ color: palette.blue }}>
          start a session
        </a>{" "}
        to get a per-browser cached fragment.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <PrivateContent sessionId={sessionId} />
      <p style={{ fontSize: 13, color: palette.muted, margin: 0 }}>
        session <code>{sessionId}</code> ·{" "}
        <a href="/api/session" style={{ color: palette.blue }}>
          rotate session
        </a>{" "}
        ·{" "}
        <a href="/api/session?clear=1" style={{ color: palette.blue }}>
          end session
        </a>
      </p>
    </div>
  );
}

/**
 * Everything cache-related renders inside this dynamic subtree.
 * `connection()` opts it out of prerendering, so the fragments are excluded
 * from the PPR static shell and Next's page-level incremental cache (a
 * separate system from cacheHandlers, backed by per-pod disk). Without this,
 * every fragment with stale >= the route's stale-time is served straight
 * from the cached page shell - never consulting the memcached handler, which
 * reads as "still cached" during an outage. cacheComponents requires the
 * dynamic access to sit under a <Suspense> boundary, hence the wrapper.
 */
async function DemoSections() {
  await connection();
  return (
    <>
      <Section
        title="1. Public cacheable content"
        intro="Identical for every visitor. Re-render as often as you like — until the entry expires or is invalidated, the timestamp does not move."
      >
        <Suspense fallback="loading">
          <PublicContent />
        </Suspense>
      </Section>

      <Section
        title="2. Private cacheable content (per browser session)"
        intro={
          <>
            The session id from a cookie is passed as an argument into the
            cached function, so it becomes part of the cache key — open this
            page in a second browser or incognito window and each session sees
            its own independently frozen timestamp. Note: Next 16 does have{" "}
            <code>'use cache: private'</code>, but its handler "cannot be
            customized" — private entries never reach the shared memcached
            handler, which is why this demo uses the cookie-argument approach
            instead.
          </>
        }
      >
        <Suspense fallback="loading session">
          <PrivateSection />
        </Suspense>
      </Section>

      <Section
        title="3a. Invalidate one entry"
        intro={
          <>
            Next.js has no key-level invalidation API — this fragment carries
            its own unique tag <code>entry:demo-1</code>, so hard-invalidating
            that tag hits exactly one entry.
          </>
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          <Suspense fallback="loading">
            <EntryDemo />
          </Suspense>
          <span>
            <ActionButton
              href="/api/invalidate?tag=entry:demo-1&mode=hard"
              label="Invalidate this entry (hard)"
              tone="red"
            />
          </span>
        </div>
      </Section>

      <Section
        title="3b. Invalidate a tag across multiple entries"
        intro={
          <>
            <code>tag-a</code> is carried by BOTH ShortTtlTagA and LongTtlTagA —
            hard-invalidating it changes both at once while ShortTtlTagB (tag-b)
            stays frozen. The soft variant (
            <code>revalidateTag(tag, 'max')</code>) is stale-while-revalidate:
            the next render serves the stale value one last time while the entry
            refreshes in the background — expect the timestamps to move on the
            render after that.
          </>
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          <Suspense fallback="loading">
            <ShortTtlTagA />
          </Suspense>
          <Suspense fallback="loading">
            <ShortTtlTagB />
          </Suspense>
          <Suspense fallback="loading">
            <LongTtlTagA />
          </Suspense>
          <Suspense fallback="loading">
            <MultiTagABC />
          </Suspense>
          <Suspense fallback="loading">
            <SharedTagC />
          </Suspense>
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              href="/api/invalidate?tag=tag-a&mode=hard"
              label="Invalidate tag-a (hard, all entries)"
              tone="red"
            />
            <ActionButton
              href="/api/invalidate?tag=tag-a&mode=soft"
              label="Invalidate tag-a (soft, serve-stale-once)"
              tone="yellow"
            />
            <ActionButton
              href="/api/revalidate-path?path=/"
              label="Revalidate path /"
              tone="blue"
            />
          </span>
        </div>
      </Section>

      <Section
        title="3c. TTL profiles"
        intro="Contrast the short-TTL fragments above (expire 10s) with the default profile and a very long-running entry (expire 24h) that only tag/path invalidation will move."
      >
        <div style={{ display: "grid", gap: 8 }}>
          <Suspense fallback="loading">
            <DefaultProfileNoTag />
          </Suspense>
          <Suspense fallback="loading">
            <VeryLongTtl />
          </Suspense>
        </div>
      </Section>

      <Section
        title="4. Memcached inspection"
        intro="Raw-socket enumeration of every key currently in memcached (lru_crawler metadump, cachedump fallback) with the handler's envelope metadata decoded. This is the ground truth: if fragments look cached but this table is empty, values are NOT reaching the shared cache."
      >
        <DebugPanel />
      </Section>
    </>
  );
}

export default function Home() {
  return (
    <main
      style={{
        maxWidth: 920,
        margin: "0 auto",
        padding: "24px 16px 64px",
        color: palette.text,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 24 }}>
        @seatgeek/next-memcached — interactive demo
      </h1>
      <p style={{ color: palette.muted, fontSize: 14 }}>
        Every fragment below is its own <code>'use cache'</code> boundary stored
        in memcached via the custom cache handler. Each shows the moment its
        value was produced — on a cache hit the timestamp stays frozen; that IS
        the proof of caching. The panel at the bottom reads memcached directly
        over a raw socket, so you can verify entries land in the shared cache
        and not an in-process LRU.
      </p>
      <p>
        <RefreshButton />
      </p>
      <Suspense fallback={<p style={{ color: palette.muted }}>loading demo</p>}>
        <DemoSections />
      </Suspense>
    </main>
  );
}
