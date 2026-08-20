"use client";

import { useCallback, useEffect, useState } from "react";

const palette = {
  text: "#181818",
  muted: "#767575",
  border: "#DEDDDB",
  panel: "#F5F5F4",
  blue: "#1C71EF",
  fresh: "#11A669",
  stale: "#BE8F22",
  down: "#DB1600",
};

import type { DebugKeysResponse as DebugResponse } from "@/lib/debug-keys";

/**
 * The proof panel: enumerates what's ACTUALLY in memcached via a raw socket
 * (/api/debug/keys), independent of the handler package. If `'use cache'`
 * entries were quietly landing in an in-process LRU instead, this table
 * would stay empty while the fragments above still looked "cached".
 */
export function DebugPanel() {
  const [data, setData] = useState<DebugResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/debug/keys", { cache: "no-store" });
      setData((await res.json()) as DebugResponse);
    } catch (err) {
      setData({
        target: "?",
        source: null,
        count: 0,
        truncated: false,
        keys: [],
        error: (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        padding: 16,
        fontSize: 13,
        color: palette.text,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          style={{
            padding: "6px 12px",
            border: "none",
            borderRadius: 6,
            background: palette.blue,
            color: "#FFFFFF",
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "loading…" : "Refresh"}
        </button>
        {data && (
          <span>
            <strong
              style={{ color: data.count > 0 ? palette.fresh : palette.muted }}
            >
              {data.count} key{data.count === 1 ? "" : "s"} in memcached
            </strong>{" "}
            <span style={{ color: palette.muted }}>
              ({data.target}
              {data.source ? ` via ${data.source}` : ""}
              {data.truncated ? ", values truncated to first 200" : ""})
            </span>
          </span>
        )}
      </div>

      {data?.error && (
        <p style={{ color: palette.down, fontWeight: 600 }}>
          memcached unreachable: {data.error}
        </p>
      )}

      {data && !data.error && data.count === 0 && (
        <p style={{ color: palette.muted }}>
          0 keys — either cache is cold or entries are NOT reaching memcached.
        </p>
      )}

      {data && data.keys.length > 0 && (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
          }}
        >
          <thead>
            <tr>
              {["key", "kind", "tags", "cached at", "TTL", "size"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "4px 8px",
                    borderBottom: `2px solid ${palette.border}`,
                    background: palette.panel,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.keys.map((k) => (
              <tr key={k.key}>
                <td style={cell} title={k.valuePreview}>
                  {k.key}
                </td>
                <td
                  style={{
                    ...cell,
                    color:
                      k.kind === "entry"
                        ? palette.fresh
                        : k.kind === "tag"
                          ? palette.stale
                          : palette.muted,
                  }}
                >
                  {k.kind}
                </td>
                <td style={cell}>{k.tags?.join(", ") ?? "—"}</td>
                <td style={cell}>
                  {k.cachedAt
                    ? new Date(k.cachedAt).toISOString().replace("T", " ")
                    : "—"}
                </td>
                <td style={cell}>
                  {k.exp === -1
                    ? "never"
                    : k.ttlSeconds !== null
                      ? `${k.ttlSeconds}s`
                      : "—"}
                </td>
                <td style={cell}>{k.sizeBytes} B</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid #DEDDDB",
  verticalAlign: "top",
  wordBreak: "break-all",
};
