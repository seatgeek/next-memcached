import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { BASE_URL, sleep } from "./helpers";

const STARTUP_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

let server: ChildProcess | undefined;
let serverExit: { code: number | null; signal: string | null } | undefined;

const probe = async (pathname = "/"): Promise<boolean> => {
  try {
    const res = await fetch(`${BASE_URL}${pathname}`, {
      headers: { accept: "text/html" },
    });
    return res.ok;
  } catch {
    return false;
  }
};

const waitForReady = async (): Promise<void> => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverExit) {
      throw new Error(
        `example app exited during startup (code ${serverExit.code}, signal ${serverExit.signal})`,
      );
    }
    if (await probe()) return;
    await sleep(500);
  }
  throw new Error(`example app did not become ready at ${BASE_URL}`);
};

/**
 * The spawned server must be talking to the memcached this run targets -
 * /api/debug/keys reports the host:port it actually connected with, so a
 * leftover server from a previous mode (different MEMCACHED_URI) is caught
 * here instead of silently passing the wrong suite.
 */
const assertServerIdentity = async (expectedUri: string): Promise<void> => {
  const res = await fetch(`${BASE_URL}/api/debug/keys`);
  const body = (await res.json()) as { target: string };
  const stripped = expectedUri.replace(/^[a-z+]+:\/\//i, "");
  const [host, port] = stripped.split(":");
  const expected = `${host || "localhost"}:${port || 11211}`;
  if (body.target !== expected) {
    throw new Error(
      `server at ${BASE_URL} targets memcached "${body.target}", expected "${expected}" — is a stale server still running?`,
    );
  }
};

const killServer = async (): Promise<void> => {
  if (!server || serverExit) return;
  const exited = new Promise<void>((resolve) => {
    server?.once("exit", () => resolve());
  });
  if (server.pid) {
    // Negative pid kills the detached process group (next + its workers).
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
  }
  // Await exit so the next run's `next start` doesn't race for the port.
  await Promise.race([exited, sleep(SHUTDOWN_TIMEOUT_MS)]);
  if (!serverExit && server.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      server.kill("SIGKILL");
    }
    await exited;
  }
};

/**
 * Boots the example app (assumed already built), inheriting MEMCACHED_URI /
 * MEMCACHED_TLS_CA so the same suite runs against the plain and TLS
 * memcached services.
 */
export const setup = async (): Promise<void> => {
  if (await probe()) {
    throw new Error(
      `something is already serving ${BASE_URL} — stop it (or a leftover e2e server) before running the suite`,
    );
  }

  const repoRoot = path.join(import.meta.dirname, "..");
  const appDir = path.join(repoRoot, "examples", "next-app");
  // The app process runs with cwd = appDir; a CA path given relative to the
  // repo root (certs/cacert.pem) must be absolutized before it inherits.
  const env = { ...process.env };
  if (env.MEMCACHED_TLS_CA) {
    env.MEMCACHED_TLS_CA = path.resolve(repoRoot, env.MEMCACHED_TLS_CA);
  }
  // Spawn the next binary directly (not `pnpm start`) so teardown's SIGTERM
  // doesn't make pnpm print a spurious ELIFECYCLE failure into the CI log.
  const nextBin = path.join(appDir, "node_modules", ".bin", "next");
  server = spawn(nextBin, ["start"], {
    cwd: appDir,
    stdio: "inherit",
    env,
    detached: true,
  });
  server.once("error", (err) => {
    serverExit = { code: null, signal: null };
    console.error(`failed to spawn ${nextBin}:`, err.message);
  });
  server.once("exit", (code, signal) => {
    serverExit = { code, signal };
  });

  try {
    await waitForReady();
    await assertServerIdentity(process.env.MEMCACHED_URI ?? "localhost:11211");
  } catch (err) {
    // vitest never calls teardown when setup throws - clean up ourselves.
    await killServer();
    throw err;
  }
};

export const teardown = async (): Promise<void> => {
  await killServer();
};
