# Deployment Runbook

Step-by-step guide for deploying FlowBoard to production. The pipeline is
already wired up — these steps are the operator-facing actions to take.

For pipeline architecture details, see [README.md → Deployment](./README.md#deployment).

---

## Prerequisites

- A GitHub repository with Actions enabled (this repo).
- For self-hosted: a Linux host with Docker ≥ 24 and ~512 MB RAM. The
  image is `linux/amd64` + `linux/arm64`, so a small VM, a Raspberry Pi,
  or a managed container runtime all work.
- A randomly generated `JWT_SECRET` — `openssl rand -hex 32` — kept out
  of the repo.

---

## Step 1 — Land code on `main`

Images only publish from pushes to `main` or from semver tags. Until the
feature branch lands on `main`, no image is built.

1. Open or update the PR. CI must show three green checks:
   `lint-typecheck-test`, `build`, `Docker build (no push)`.
2. Squash-merge the PR into `main`.
3. The push to `main` triggers `.github/workflows/release.yml`. Watch it
   under **Actions → Release**. Expected duration: 5–8 minutes (test
   gate ~1 min, multi-arch build ~5 min, attestation ~1 min).

---

## Step 2 — Verify the image landed in GHCR

After the Release workflow turns green:

1. Open `https://github.com/wankhede04/flow-board/pkgs/container/flow-board`.
2. You should see the package with these tags: `main`, `main-<sha>`, `latest`.
3. The package is **private by default** on first publish. To deploy
   without a PAT, change visibility:
   - Click the package → **Package settings** (right sidebar)
   - **Danger Zone → Change visibility → Public**
   - Or, leave private and have the host authenticate with a PAT scoped
     to `read:packages`.

---

## Step 3 — Cut a versioned release (recommended)

The first push to `main` produces `latest` and `main-<sha>` images. For
production traffic you want an immutable, attestable version tag.

```bash
git checkout main
git pull
git tag -a v0.1.0 -m "v0.1.0 — initial release"
git push origin v0.1.0
```

This triggers the Release workflow's tag path, which additionally:

- Publishes immutable tags `0.1.0`, `0.1`, `1`, plus `latest`
- Generates SLSA build provenance (verifiable with `cosign verify-attestation`)
- Creates a GitHub Release at `/releases/tag/v0.1.0` with auto-generated notes

---

## Step 4 — Deploy

Pick one path. All paths use the same image.

### 4a. Single VM with docker-compose (simplest)

On the host:

```bash
mkdir -p /opt/flowboard && cd /opt/flowboard
curl -fsSL https://raw.githubusercontent.com/wankhede04/flow-board/main/docker-compose.yml -o docker-compose.yml

# One-time: write env file (NOT committed anywhere)
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
FLOWBOARD_IMAGE=ghcr.io/wankhede04/flow-board:0.1.0
FLOWBOARD_PORT=3000
EOF

docker compose pull
docker compose up -d
docker compose logs -f flowboard          # tail until "Ready in" appears

# Smoke test
curl -fsS http://localhost:3000/api/healthz
curl -fsS http://localhost:3000/api/readyz
```

Reverse proxy (nginx/Caddy/Traefik) terminates TLS and forwards to
`localhost:3000`. Example Caddyfile:

```
flowboard.example.com {
  reverse_proxy localhost:3000
}
```

### 4b. Plain `docker run` (smaller setup)

```bash
docker run -d \
  --name flowboard \
  --restart unless-stopped \
  -p 3000:3000 \
  -v flowboard-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/wankhede04/flow-board:0.1.0
```

### 4c. Kubernetes

A minimal manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flowboard
spec:
  replicas: 1                          # SQLite — single writer only
  strategy: { type: Recreate }         # rolling-update conflicts with the volume
  selector: { matchLabels: { app: flowboard } }
  template:
    metadata: { labels: { app: flowboard } }
    spec:
      containers:
        - name: flowboard
          image: ghcr.io/wankhede04/flow-board:0.1.0
          ports: [{ containerPort: 3000 }]
          env:
            - { name: JWT_SECRET, valueFrom: { secretKeyRef: { name: flowboard, key: jwt-secret } } }
            - { name: DATABASE_URL, value: file:/data/flowboard.db }
          volumeMounts:
            - { name: data, mountPath: /data }
          readinessProbe:
            httpGet: { path: /api/readyz, port: 3000 }
            initialDelaySeconds: 5
          livenessProbe:
            httpGet: { path: /api/healthz, port: 3000 }
            initialDelaySeconds: 15
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: flowboard-data }
---
apiVersion: v1
kind: Service
metadata: { name: flowboard }
spec:
  selector: { app: flowboard }
  ports: [{ port: 80, targetPort: 3000 }]
```

For multi-replica deployments, switch the database to Postgres
(see Step 6).

### 4d. AWS ECS / Fargate

Push the image to ECR (or pull directly from GHCR with an ECR pull-through
cache), then create a Fargate service with the same env vars and a
mounted EFS volume at `/data`. Health check path: `/api/healthz`.

---

## Step 5 — Post-deploy verification

```bash
# 1. Health probes return 200
curl -fsS https://your-host/api/healthz   # {"status":"ok"}
curl -fsS https://your-host/api/readyz    # {"status":"ready","checks":{"db":"ok"}}

# 2. Demo login works (sanity check the session + DB write path)
COOKIE=$(mktemp)
curl -fsS -c "$COOKIE" -X POST https://your-host/api/v1/auth/demo-login

# 3. Authenticated read works
curl -fsS -b "$COOKIE" https://your-host/api/v1/auth/me
```

If any step returns non-200, check `docker logs flowboard` (or pod logs)
for stack traces. The Prisma `db push` runs on every boot — first-boot
logs will show schema application.

---

## Step 6 — (Optional) Switch to Postgres

SQLite is fine for a single-host deploy. For multi-replica, HA, or
backup-friendly storage, switch to Postgres:

1. Edit `prisma/schema.prisma`: change `provider = "sqlite"` to
   `provider = "postgresql"`.
2. Commit, tag a new release, and let the pipeline rebuild the image.
3. On the host, set `DATABASE_URL=postgresql://user:pass@host:5432/flowboard`
   and remove the `flowboard-data` volume (the entrypoint runs `prisma
   db push` on first boot and creates the schema).

---

## Step 7 — Updating to a new release

```bash
# In the repo: cut a new tag.
git tag -a v0.1.1 -m "v0.1.1 — fix XYZ"
git push origin v0.1.1
# Wait for the Release workflow to publish the image.

# On the host:
sed -i 's|flow-board:0.1.0|flow-board:0.1.1|' .env   # or update FLOWBOARD_IMAGE
docker compose pull
docker compose up -d
```

The entrypoint reapplies the schema (`prisma db push`) on every boot,
which is forward-compatible per TechSpec §23.8 — additive migrations
work transparently. Destructive migrations require manual planning.

---

## Step 8 — Backups

SQLite lives in the `flowboard-data` volume at `/data/flowboard.db`. To
back up:

```bash
docker compose exec flowboard sqlite3 /data/flowboard.db ".backup /data/backup.db"
docker cp flowboard:/data/backup.db ./flowboard-$(date +%F).db
```

Schedule via cron and ship the file off-host.

---

## Rollback

If a new release misbehaves, redeploy the previous tag:

```bash
sed -i 's|flow-board:0.1.1|flow-board:0.1.0|' .env
docker compose pull
docker compose up -d
```

Image tags on GHCR are immutable, so the previous version is always
pullable. No image rebuild required.

For schema-incompatible rollbacks, restore the SQLite backup from
Step 8 before downgrading.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `denied: permission_denied` on `docker pull` | GHCR package is private | Make package public OR `docker login ghcr.io -u <user> -p <PAT>` (PAT needs `read:packages`) |
| Container restarts in a loop, logs `prisma db push` errors | DB volume mounted from a previous incompatible schema | Restore from backup, or wipe `flowboard-data` if non-prod |
| 502 / connection refused at the proxy | Container booting; `prisma db push` runs first | Wait ~10s; check `docker logs flowboard` for `Ready in` line |
| "Database is locked" under load | SQLite single-writer limit | Switch to Postgres (Step 6) |
| Image pulls succeed but `cosign verify` fails | Verifying with the wrong identity | The image is signed via GitHub OIDC; verify with `cosign verify --certificate-identity-regexp 'https://github.com/wankhede04/flow-board/.github/workflows/release.yml@.*' --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/wankhede04/flow-board:<tag>` |
