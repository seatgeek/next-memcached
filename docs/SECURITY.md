# Security Policy

## Supported Versions

Only the latest published version of `@seatgeek/next-memcached` receives security updates.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report vulnerabilities privately via [GitHub Security Advisories](https://github.com/seatgeek/next-memcached/security/advisories/new) or by emailing opensource@seatgeek.com. We will acknowledge reports as quickly as we can and keep you informed of the fix timeline.

## Scope note

This package is a cache adapter between Next.js and memcached. Two properties matter for threat modeling:

- **memcached has no authentication or authorization.** Access control is entirely the network boundary (VPC / security groups / localhost). The handler adds none; anyone who can reach the memcached endpoint can read and write every cache entry. Never expose the endpoint beyond the app's network. TLS (`memcaches://`) protects data in transit, not access.
- **Cache entries are trusted input to the app.** Entries are stored as a versioned JSON envelope; anything that fails to decode is treated as a miss, never executed or partially applied. Reports around envelope parsing, key construction (`e:`/`t:` SHA-1 hashing), or cache-poisoning vectors are especially appreciated.
