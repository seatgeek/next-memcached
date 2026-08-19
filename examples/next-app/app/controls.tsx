"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const palette = {
  blue: "#1C71EF",
  red: "#DB1600",
  yellow: "#BE8F22",
  muted: "#767575",
};

/**
 * Small client button that hits one of the existing route handlers (the same
 * ones the e2e harness calls — UI and harness share one invalidation path),
 * then router.refresh()es so the server re-renders every fragment and any
 * invalidated `'use cache'` entry visibly changes.
 */
export function ActionButton({
  href,
  label,
  tone = "blue",
}: {
  href: string;
  label: string;
  tone?: "blue" | "red" | "yellow";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  async function onClick() {
    setResult(null);
    try {
      const res = await fetch(href);
      const body = await res.json().catch(() => null);
      setResult(res.ok ? JSON.stringify(body) : `HTTP ${res.status}`);
    } catch (err) {
      setResult(`failed: ${(err as Error).message}`);
    }
    startTransition(() => router.refresh());
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        style={{
          padding: "6px 12px",
          border: "none",
          borderRadius: 6,
          background: palette[tone],
          color: "#FFFFFF",
          fontSize: 13,
          cursor: isPending ? "wait" : "pointer",
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? "refreshing…" : label}
      </button>
      {result && (
        <code style={{ fontSize: 11, color: palette.muted }}>{result}</code>
      )}
    </span>
  );
}

/** Plain re-render (no invalidation) — shows hits keeping timestamps frozen. */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      style={{
        padding: "6px 12px",
        borderRadius: 6,
        border: `1px solid ${palette.blue}`,
        background: "#FFFFFF",
        color: palette.blue,
        fontSize: 13,
        cursor: isPending ? "wait" : "pointer",
      }}
    >
      {isPending ? "re-rendering…" : "Re-render page (no invalidation)"}
    </button>
  );
}
