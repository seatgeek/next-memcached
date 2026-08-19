# Contributing

Thanks for helping improve `@seatgeek/next-memcached`! Most contributions are reliability fixes, documentation, or coverage of new Next.js cache semantics; the package is deliberately a thin, fail-safe adapter.

## Setup

Toolchain is pinned with [mise](https://mise.jdx.dev) (Node 22, pnpm 10):

```sh
make init       # mise install + pnpm install
make services   # docker compose up -d: memcached plain :11211 + TLS-only :21211
```

No mise? Any Node >= 22.19 with pnpm 10 works: `pnpm install`. Docker is required for the test suite, which is an **integration suite** against live memcached (the TLS service uses checked-in test certs under `certs/`, regenerate with `certs/make-certs.sh`).

## Development loop

```sh
make check        # typecheck + lint + test + build + export checks (what CI runs)
make test         # vitest with coverage (requires make services)
pnpm test:watch   # vitest watch mode
make format       # biome auto-fix
make pack-check   # npm pack --dry-run: verify tarball contents stay minimal
make example      # build the package + run examples/next-app against the services
```

## Ground rules

The package's behavioral invariants live in [AGENTS.md](../AGENTS.md); read them before changing `src/`. The short version:

- **A dead memcached must be invisible to users.** Every handler method body is a total try/catch returning the safe default (miss / no-op). `get()` never throws; nothing in this package may ever surface as a render error.
- **Eviction may cost extra misses, never stale data.** A missing tag record always reads as "just invalidated" and is re-seeded with `add` (so a concurrent real invalidation wins).
- Envelope changes require bumping `ENVELOPE_VERSION`; unknown versions decode as misses (mixed-version pods during rolling deploys).
- `set()` drains the entry stream on every path, including skips.
- TTLs stay in [1s, 30d]; never pass 0 to memcached.
- Coverage thresholds in `vitest.config.ts` only go up; new behavior needs tests.

## Package minimality

The published tarball is allowlisted via `"files": ["dist"]` in `package.json` (source of truth). `.npmignore` exists only as a defensive denylist behind it. After any packaging change, run `make pack-check` and confirm only `dist/`, `package.json`, and `LICENSE` ship. (The README lives in `docs/`, outside the package root, so npm does not pack it; the npm package page has no readme until that's addressed.)

## The example app

[`examples/next-app`](../examples/next-app/README.md) is a runnable Next.js 16 demo that doubles as the manual smoke test:

```sh
make services
make example      # http://localhost:3000
```

Before a release, click through: fresh values on first load, stable values on reload, hard invalidation changes only the targeted tag, soft invalidation serves stale once then refreshes, and `docker compose stop` keeps the app serving (uncached) with zero errors.

## Releases

Releases use [changesets](https://github.com/changesets/changesets); include one with any behavior-changing PR (`pnpm changeset`: pick the bump level, write a summary; it becomes the CHANGELOG entry).

Publishing is tag-driven and multiply gated; **merging to `main` never publishes**. The full flow (versioning, guards, the `npm-publish` environment approval, one-time npm setup) lives in [RELEASING.md](./RELEASING.md). Run the example-app smoke test above before tagging a release.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](./SECURITY.md) and please report privately.
