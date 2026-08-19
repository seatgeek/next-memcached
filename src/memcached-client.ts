import { readFileSync } from "node:fs";
// memcache ^1.10.0 is a hard floor: it is the first release with TLS
// (the `tls` option and the memcaches:// scheme relied on below, added
// via jaredwray/memcache#115). Earlier versions cannot reach TLS-mandatory
// targets like ElastiCache Serverless at all.
import { Memcache, type MemcacheOptions } from "memcache";

const DEFAULT_URI = "localhost:11211";

// Tight operation timeout per the reliability contract: a dead memcached
// must never stall a render beyond this budget (client default is 5000ms).
const OPERATION_TIMEOUT_MS = 750;

// CA bundle for TLS targets (MEMCACHED_TLS_CA env) — read once per path.
// Without it, memcaches:// URIs still work: the client falls back to
// `tls: true` (Node's default trust store — the real ElastiCache case).
let cachedCa: { path: string; ca: Buffer } | undefined;
const readCa = (path: string): Buffer => {
  if (cachedCa?.path !== path) cachedCa = { path, ca: readFileSync(path) };
  return cachedCa.ca;
};

const tlsOptions = (): Pick<MemcacheOptions, "tls"> => {
  const caPath = process.env.MEMCACHED_TLS_CA;
  return caPath ? { tls: { ca: readCa(caPath) } } : {};
};

export const createClient = (uri?: string): Memcache =>
  new Memcache({
    nodes: [uri ?? process.env.MEMCACHED_URI ?? DEFAULT_URI],
    timeout: OPERATION_TIMEOUT_MS,
    retries: 0,
    ...tlsOptions(),
  });

let sharedClient: Memcache | undefined;

/** Lazy singleton — created on first cache operation, not at module load. */
export const getSharedClient = (): Memcache => {
  sharedClient ??= createClient();
  return sharedClient;
};
