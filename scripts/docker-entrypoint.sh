#!/bin/sh
# Container entrypoint.
#
# - applies the Prisma schema to the configured DATABASE_URL (idempotent;
#   safe to run on every boot per TechSpec §23.8 forward-compatible rule)
# - then exec's the upstream CMD (the Next.js standalone server).
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "FATAL: DATABASE_URL must be set" >&2
  exit 1
fi

echo "[entrypoint] applying schema (prisma db push)..."
prisma db push --skip-generate --accept-data-loss=false

if [ "${SEED_ON_BOOT:-0}" = "1" ]; then
  echo "[entrypoint] SEED_ON_BOOT=1 — seed script not bundled in runtime image; skipping."
  echo "[entrypoint] Note: on an empty database, the first sign-in (OAuth, or demo login"
  echo "[entrypoint] when ALLOW_DEMO_LOGIN=true) bootstraps a starter workspace automatically."
fi

echo "[entrypoint] starting: $*"
exec "$@"
