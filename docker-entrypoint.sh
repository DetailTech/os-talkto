#!/bin/sh
set -eu

if [ "${ENABLE_SELF_SIGNED_TLS:-false}" = "true" ]; then
  exec node tls-proxy.mjs
fi

exec node server.js
