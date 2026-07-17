# syntax=docker/dockerfile:1.7

# FlowBoard — production image.
# Multi-stage build per TechSpec §23.15. The runtime image runs the Next.js
# standalone server (which bundles its own slim node_modules) under a
# non-root user, plus a minimal prisma CLI for one-shot schema sync at boot.

ARG NODE_VERSION=20.18.1
ARG PNPM_VERSION=10.33.0
ARG PRISMA_VERSION=5.22.0

# ---- 1. deps: install with frozen lockfile ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
WORKDIR /app

# Install pnpm directly via npm — corepack in older Node images rejects
# recent pnpm signatures, which fails the build instantly.
RUN npm install -g --no-audit --no-fund pnpm@${PNPM_VERSION}

# OpenSSL is required by Prisma engines on Debian slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile

# ---- 2. build: prisma generate + next build (standalone output) ----
FROM deps AS builder
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL is required for `prisma generate` to read at build time — it
# only needs to parse as a valid Postgres URL, it's never connected to
# during the build. Runtime always overrides it with the real value.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm db:generate \
 && pnpm build

# ---- 3. runtime: minimal image with standalone server + prisma CLI ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG PRISMA_VERSION
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs --home /app nextjs \
 && npm install -g --no-audit --no-fund prisma@${PRISMA_VERSION} \
 && npm cache clean --force \
 && chown -R nextjs:nodejs /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL has no default — it must be provided at runtime (Postgres
# connection string). The entrypoint fails fast if it's unset.

# Standalone bundle includes the slice of node_modules (and Prisma engines)
# that the server needs at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

# Schema is needed by the entrypoint to run `prisma db push` on boot.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

COPY --chown=nextjs:nodejs scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||3000) +'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
