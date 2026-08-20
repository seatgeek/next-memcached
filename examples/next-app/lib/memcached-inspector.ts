import * as net from "node:net";
import * as tls from "node:tls";

/**
 * Minimal raw text-protocol memcached client behind the demo app's
 * /api/debug/keys inspection endpoint (which the e2e suite consumes over
 * HTTP - deliberately not imported directly, so the app process with its
 * own MEMCACHED_URI/TLS env stays the single source of truth for what the
 * handler sees).
 *
 * Deliberately has zero dependency on any driver/handler package - it must
 * work before either exists, so both consumers can independently verify
 * what's actually sitting in memcached rather than trusting the app's own
 * claims.
 */

export interface InspectorOptions {
  host: string;
  port: number;
  tls?: boolean;
  caFile?: Buffer;
  timeoutMs?: number;
}

/** `host:port`, `memcached://host:port`, or bare `host` (port 11211). */
export function parseMemcachedUri(uri: string): { host: string; port: number } {
  const stripped = uri.replace(/^[a-z+]+:\/\//i, "");
  const [host, port] = stripped.split(":");
  return { host: host || "localhost", port: Number(port) || 11211 };
}

function connect(opts: InspectorOptions): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const timeout = opts.timeoutMs ?? 2000;
    const onError = (err: Error) => reject(err);

    const socket = opts.tls
      ? tls.connect({
          host: opts.host,
          port: opts.port,
          ca: opts.caFile,
          rejectUnauthorized: !!opts.caFile,
        })
      : net.connect({ host: opts.host, port: opts.port });

    socket.setTimeout(timeout);
    socket.once("error", onError);
    socket.once("timeout", () => reject(new Error("connect timeout")));
    socket.once(opts.tls ? "secureConnect" : "connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

/**
 * A reply is complete when its last full line is one of memcached's terminal
 * responses. (Line-based framing is fine here: our envelope values are
 * single-line JSON; a general-purpose client would frame by the VALUE
 * header's byte count instead.)
 */
const TERMINAL_LINE =
  /^(END|OK|ERROR|STORED|NOT_STORED|EXISTS|NOT_FOUND|DELETED|TOUCHED|BUSY.*|BADCLASS.*|CLIENT_ERROR.*|SERVER_ERROR.*)$/;

function sendAndRead(
  socket: net.Socket,
  command: string,
  timeoutMs = 2000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (!buffer.endsWith("\r\n")) return;
      const lines = buffer.split("\r\n");
      const lastLine = lines[lines.length - 2] ?? "";
      if (TERMINAL_LINE.test(lastLine)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for reply to: ${command.trim()}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(command);
  });
}

/** Raw `get <key>` - returns the value string, or undefined on a miss. */
export async function inspectGet(
  opts: InspectorOptions,
  key: string,
): Promise<string | undefined> {
  const socket = await connect(opts);
  try {
    const reply = await sendAndRead(socket, `get ${key}\r\n`);
    if (reply.startsWith("END\r\n")) return undefined;
    // VALUE <key> <flags> <bytes>\r\n<data...>\r\nEND\r\n
    const lines = reply.split("\r\n");
    return lines.slice(1, -2).join("\r\n");
  } finally {
    socket.destroy();
  }
}

/**
 * Multi-key `get` over a SINGLE connection. One socket per key doesn't
 * scale: enumerating a full keyspace would open hundreds of parallel
 * connections (each a fresh TLS handshake on memcaches:// targets), which
 * fail under load and silently misclassify keys. Same single-line-value
 * framing assumption as inspectGet.
 */
export async function inspectGetMany(
  opts: InspectorOptions,
  keys: string[],
): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  if (keys.length === 0) return values;
  const socket = await connect(opts);
  try {
    const BATCH = 50; // keep each command line comfortably bounded
    for (let start = 0; start < keys.length; start += BATCH) {
      const batch = keys.slice(start, start + BATCH);
      const reply = await sendAndRead(socket, `get ${batch.join(" ")}\r\n`);
      const lines = reply.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const header = lines[i].match(/^VALUE (\S+) \d+ \d+/);
        if (header) {
          values.set(header[1], lines[i + 1]);
          i++;
        }
      }
    }
    return values;
  } finally {
    socket.destroy();
  }
}

/** Raw `stats` - returns key/value pairs. */
export async function inspectStats(
  opts: InspectorOptions,
): Promise<Record<string, string>> {
  const socket = await connect(opts);
  try {
    const reply = await sendAndRead(socket, "stats\r\n");
    const stats: Record<string, string> = {};
    for (const line of reply.split("\r\n")) {
      const match = line.match(/^STAT (\S+) (.+)$/);
      if (match) stats[match[1]] = match[2];
    }
    return stats;
  } finally {
    socket.destroy();
  }
}

export async function flushAll(opts: InspectorOptions): Promise<void> {
  const socket = await connect(opts);
  try {
    await sendAndRead(socket, "flush_all\r\n");
  } finally {
    socket.destroy();
  }
}

/**
 * Dump-style commands (`lru_crawler metadump`) don't follow the usual
 * one-terminal-line framing: the crawler first replies `OK\r\n`, then streams
 * `key=…` lines terminated by bare `\n`, then a final `END\r\n`. Read until
 * that trailing END (or an immediate error response).
 */
function readDump(
  socket: net.Socket,
  command: string,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const done =
        buffer.endsWith("END\r\n") ||
        (buffer.endsWith("\r\n") &&
          /^(ERROR|CLIENT_ERROR|SERVER_ERROR|BUSY|BADCLASS)/.test(buffer));
      if (done) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for reply to: ${command.trim()}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(command);
  });
}

export interface KeyMeta {
  key: string;
  /** Unix expiry time; -1 = never expires. */
  exp: number;
  /** Stored size in bytes (item size for metadump, value size for cachedump). */
  size: number;
}

export interface KeyListing {
  source: "metadump" | "cachedump";
  keys: KeyMeta[];
}

/**
 * Enumerate ALL keys. Primary path: `lru_crawler metadump all`
 * (memcached 1.6.44 supports it; lines look like
 * `key=<urlencoded> exp=<unix|-1> la=<unix> cas=.. fetch=.. cls=.. size=<bytes>`
 * terminated by END). Fallback when the crawler is unavailable:
 * `stats items` + per-slab `stats cachedump <slab> 0`.
 */
export async function listKeys(opts: InspectorOptions): Promise<KeyListing> {
  const socket = await connect(opts);
  try {
    const reply = await readDump(
      socket,
      "lru_crawler metadump all\r\n",
      opts.timeoutMs ?? 5000,
    );
    if (/^(ERROR|CLIENT_ERROR|SERVER_ERROR|BUSY|BADCLASS)/.test(reply)) {
      return { source: "cachedump", keys: await cachedumpKeys(socket) };
    }
    const keys: KeyMeta[] = [];
    // Dump lines are LF-terminated; OK preamble and END trailer are CRLF.
    for (const line of reply.split(/\r?\n/)) {
      const match = line.match(/^key=(\S+) exp=(-?\d+) .*\bsize=(\d+)/);
      if (!match) continue;
      keys.push({
        key: safeDecodeUriComponent(match[1]),
        exp: Number(match[2]),
        size: Number(match[3]),
      });
    }
    return { source: "metadump", keys };
  } finally {
    socket.destroy();
  }
}

async function cachedumpKeys(socket: net.Socket): Promise<KeyMeta[]> {
  const itemsReply = await sendAndRead(socket, "stats items\r\n");
  const slabs = new Set<string>();
  for (const line of itemsReply.split("\r\n")) {
    const match = line.match(/^STAT items:(\d+):/);
    if (match) slabs.add(match[1]);
  }
  const keys: KeyMeta[] = [];
  for (const slab of slabs) {
    const dump = await sendAndRead(socket, `stats cachedump ${slab} 0\r\n`);
    for (const line of dump.split("\r\n")) {
      // ITEM <key> [<size> b; <exp> s]
      const match = line.match(/^ITEM (\S+) \[(\d+) b; (-?\d+) s\]$/);
      if (!match) continue;
      keys.push({
        key: match[1],
        exp: Number(match[3]),
        size: Number(match[2]),
      });
    }
  }
  return keys;
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
