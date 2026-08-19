import { describe, expect, it } from "vitest";
import { decodeEntry, encodeEntry } from "./envelope.js";

const meta = {
  tags: ["tag-a", "tag-b"],
  stale: 60,
  timestamp: 1_786_657_703_123.456,
  expire: 300,
  revalidate: 120,
};

describe("envelope", () => {
  it("encode/decode round trip preserves metadata and body bytes", () => {
    const body = Buffer.from([0, 1, 2, 255, 254, 10, 13]); // binary-safe
    const encoded = encodeEntry(meta, body);
    expect(encoded).toBeTypeOf("string");
    const decoded = decodeEntry(encoded as string);
    expect(decoded).toBeDefined();
    expect(decoded?.tags).toEqual(meta.tags);
    expect(decoded?.stale).toBe(meta.stale);
    expect(decoded?.timestamp).toBe(meta.timestamp);
    expect(decoded?.expire).toBe(meta.expire);
    expect(decoded?.revalidate).toBe(meta.revalidate);
    expect(decoded?.body.equals(body)).toBe(true);
  });

  it("decode returns undefined on non-JSON input", () => {
    expect(decodeEntry("not json")).toBeUndefined();
  });

  it("decode returns undefined on version mismatch", () => {
    const encoded = encodeEntry(meta, Buffer.from("x")) as string;
    const tampered = JSON.stringify({ ...JSON.parse(encoded), v: 2 });
    expect(decodeEntry(tampered)).toBeUndefined();
  });

  it("decode returns undefined on shape mismatch", () => {
    const encoded = encodeEntry(meta, Buffer.from("x")) as string;
    const parsed = JSON.parse(encoded);
    expect(
      decodeEntry(JSON.stringify({ ...parsed, tags: "oops" })),
    ).toBeUndefined();
    expect(
      decodeEntry(JSON.stringify({ ...parsed, timestamp: "oops" })),
    ).toBeUndefined();
    expect(
      decodeEntry(JSON.stringify({ ...parsed, body: 42 })),
    ).toBeUndefined();
    expect(decodeEntry("null")).toBeUndefined();
    expect(decodeEntry("[1,2]")).toBeUndefined();
  });

  it("encode skips entries over the memcached item cap", () => {
    const oversized = Buffer.alloc(1024 * 1024, 7); // >900KB after base64
    expect(encodeEntry(meta, oversized)).toBeUndefined();
  });
});
