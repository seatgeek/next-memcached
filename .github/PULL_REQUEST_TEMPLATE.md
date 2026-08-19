# Description

<!-- What does this PR change, and why? -->

## Checklist

- [ ] `make check` passes locally (typecheck, lint, tests, build, export checks; start `make services` first)
- [ ] New behavior is covered by tests
- [ ] The reliability invariants in [AGENTS.md](../AGENTS.md) still hold (every handler method fail-safe, missing tag records read as expired, streams always drained, TTLs clamped)
- [ ] Added a changeset (`pnpm changeset`) if this should trigger a release
- [ ] README/docs updated if user-facing behavior changed
