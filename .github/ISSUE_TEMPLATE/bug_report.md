---
name: Bug report
about: Wrong cache behavior, an error surfaced from the handler, or a broken build
title: ''
labels: bug
assignees: ''
---

## What happened

<!-- Describe the bug. Wrong data served? Stale after invalidation? An error
in the render path (this handler must NEVER surface one, so that's always a
bug here)? -->

## Reproduction

<!-- Smallest possible setup, e.g. the 'use cache' fragment + the
invalidation call + the request sequence that misbehaves. -->

**`next.config` cache wiring (`cacheHandlers`, `cacheMaxMemorySize`):**
**`MEMCACHED_URI` shape (plain / `memcaches://`, single node / ElastiCache Serverless):**
**Expected:**
**Actual:**

## Environment

- `@seatgeek/next-memcached` version:
- Next.js version:
- memcached: (docker image / ElastiCache node-based / ElastiCache Serverless)
- Node version:
