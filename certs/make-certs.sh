#!/usr/bin/env bash
# Generates the test CA + server cert for the memcached-tls compose service,
# following memcached's own test-suite recipe (t/README-TLS.md). The generated
# certs are checked in (test-only material, 10y expiry) so `pnpm
# test:services:start && pnpm test` works from a fresh clone; rerun this
# script to rotate them.
#
# ssl_verify_mode stays 0 server-side (no client cert requested) — matches
# ElastiCache Serverless, which does not support mTLS.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

DAYS=3650
SAN="subjectAltName=DNS:memcached-tls,DNS:localhost,IP:127.0.0.1"

echo "==> generating CA"
openssl genrsa -out cacert.key 2048
openssl req -new -x509 -key cacert.key -out cacert.pem -days "$DAYS" \
  -subj "/CN=memcache test CA"

echo "==> generating server key + CSR"
openssl genrsa -out server_key.pem 2048
openssl req -new -key server_key.pem -out server.csr \
  -subj "/CN=memcached-tls"

echo "==> signing server cert (SAN: $SAN)"
openssl x509 -req -in server.csr -CA cacert.pem -CAkey cacert.key \
  -CAcreateserial -out server_crt.pem -days "$DAYS" \
  -extfile <(printf "%s" "$SAN")

rm -f server.csr cacert.key cacert.srl

# memcached's official image runs as the `memcache` user (uid 11211); the
# key must be world-readable inside the container since we bind-mount it.
chmod 644 server_key.pem server_crt.pem cacert.pem

echo "==> done: cacert.pem, server_crt.pem, server_key.pem"
