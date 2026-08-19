# Releasing

How a version of `@seatgeek/next-memcached` gets to npm. The short version: changesets accumulate on `main`, a maintainer versions them, and **pushing a `v<version>` tag triggers the publish**, still gated by guards and a human environment approval. Pushing commits to `main` never publishes.

## One-time setup (before the first release)

These exist outside the repo and must be configured once by an admin:

1. **npm scope access**: confirm publish rights on the `@seatgeek` scope for the package name.
2. **The `npm-publish` GitHub Environment**: create it explicitly under *Settings → Environments* and add **required reviewers**. This is the human approval gate.

   > [!WARNING]
   > If the workflow runs while the environment doesn't exist, GitHub silently auto-creates it **with no protection rules**, leaving the approval gate hollow. Create it, with reviewers, before the first dispatch.

3. **`NPM_TOKEN`**: store it as a secret **on the `npm-publish` environment**, not at repo level. A repo-level token works mechanically but bypasses the reviewer gate's purpose; if one was added at repo level, move it and delete the repo-level copy.

   The token must be a **granular access token** scoped to the package (read/write, short expiry). A classic "Publish" token fails in CI with `EOTP` when the account requires 2FA for writes, since CI cannot answer an OTP prompt.

   > [!IMPORTANT]
   > **Treat the token as a bootstrap for the first publish only.** npm is deprecating 2FA-bypass tokens ([GitHub changelog, 2026-07-08](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/)): as of ~August 2026 they no longer bypass 2FA for management operations, and around **January 2027 they lose direct publish rights entirely** (publishes become "staged" pending a human 2FA approval). The sanctioned CI paths are trusted publishing (OIDC) or staged publishing.

   **After the first publish, migrate to [npm trusted publishing](https://docs.npmjs.com/trusted-publishers):** configure this repo + the `release` workflow as a trusted publisher in the package's npm settings, then delete the token. The workflow already has `id-token: write`, so no workflow changes are needed. (Trusted publishing historically could not perform a package's *first* publish, hence the bootstrap token.)

4. **Branch protection on `main`**: require the `ci` workflow and PR review.
5. **Tag ruleset for `v*`**: under *Settings → Rules → Rulesets*, restrict who can create `v*` tags. Tag pushes trigger publishes, so tag creation should be as protected as the approval gate.

## Release flow

1. **Changesets accumulate.** Every behavior-changing PR includes one (`pnpm changeset`: pick the bump level, write a summary; it becomes the CHANGELOG entry).
2. **Version.** A maintainer runs:

   ```sh
   pnpm changeset version   # bumps package.json, writes CHANGELOG.md, consumes .changeset/*.md
   ```

   Commit the result (e.g. `Version 0.2.0`) and get it onto `main` (PR, or direct push where allowed). Don't edit `package.json`'s version by hand: the release guard checks that changesets were consumed, and a manual bump desyncs the CHANGELOG.
3. **CI green on `main`.** The `ci` workflow must pass on the release commit, including the Next.js compat matrix.
4. **Smoke test.** Run the [example-app click-through](./CONTRIBUTING.md#the-example-app): fresh values on first load, stable on reload, hard/soft tag invalidation behave, and `docker compose stop` keeps the app serving (uncached) with zero errors.
5. **Tag to release.** Tag the release commit on `main` and push the tag; this triggers the `release` workflow:

   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

   The tag must be exactly `v<package.json version>`; a mismatch fails the guard. The workflow starts the memcached test services, re-runs every quality gate (the test suite is an integration suite and needs them), pauses for an `npm-publish` environment reviewer, publishes to npm with provenance, then **creates the GitHub Release automatically** with the version's CHANGELOG section as notes. (Fallback: a manual *Actions → release → Run workflow* dispatch from `main` also works, e.g. to retry after a transient failure; it skips the GitHub Release step since there is no tag ref.)

## The guards

The `release` workflow refuses to run when dispatched out of order. Each failure message says what to do; for reference:

| Guard | Fails when | Fix |
| --- | --- | --- |
| Ref check | Triggered by anything other than a `v*` tag or a dispatch from `main` | Push a `v*` tag, or re-dispatch from `main` |
| Tag/version match | The tag isn't exactly `v<package.json version>` | Retag the right commit, or fix the version first |
| Placeholder version | `package.json` is still `0.0.0` | Run `pnpm changeset version` and commit |
| Unconsumed changesets | `.changeset/*.md` files still present | Run `pnpm changeset version` and commit |
| Environment approval | Always pauses (when reviewers are configured) | An `npm-publish` reviewer approves the run |

## After the first release

- Verify the npm and install-size badges in the README render (they 404 until the package exists on npm).
- Remove the "not yet published" note from the README.
