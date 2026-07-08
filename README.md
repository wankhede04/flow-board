# FlowBoard

A production-ready task tracker for organising daily work and priorities —
a working implementation of the FlowBoard Kanban tracker described in
[`TechSpec.md`](./TechSpec.md), extended into a personal + professional
planning tool:

- **Kanban board** — workspaces, projects, columns with WIP limits, tickets
  with optimistic locking, comments, activity log, drag-and-drop with
  optimistic UI + rollback (TechSpec Phases 1–4).
- **Goals** — daily, weekly, monthly and yearly goals with period navigation
  (‹ prev / next ›), personal/professional contexts, check-off, and progress
  derived from linked tickets.
- **Planner & reminders** — set-time reminders (one-off or daily/weekly/
  monthly recurring), fully plannable and manually adjustable: reschedule to
  any time, snooze +15m/+1h/+1d, mark done. Delivered as in-app notifications
  and Slack DMs. Due-soon/overdue ticket nudges included.
- **Personal & professional tasks** — every ticket carries a context; the
  board, create modal, drawer and goals all filter on it.
- **Slack integration** — `/flowboard` slash commands create tickets, move
  them between columns, list your work, and set reminders; reminder DMs have
  interactive Snooze/Done buttons; ticket moves DM the reporter + assignees.
  Signed webhooks (HMAC, replay-window) per TechSpec §9.5.

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm db:push        # creates SQLite schema
pnpm db:seed        # demo workspace, project, ~20 tickets, 4 users
pnpm dev            # http://localhost:3000
```

Click **Sign in as demo user** on the home page. You'll land on the demo
workspace and can open the seeded *FlowBoard MVP* project.

## What's implemented

| Spec section | Status |
| --- | --- |
| §3 Monorepo layout | Single Next.js app instead of multi-service monorepo (deviation, see below) |
| §4 Conventions — naming, error envelope, IDs | Done |
| §5.2 Domain model | Done — Prisma schema mirrors the DDL |
| §5.4 Fractional indexing for ranks | Done — uses `fractional-indexing` |
| §6.2 REST endpoints (workspaces, projects, columns, tickets, comments, board snapshot) | Subset; full surface implemented for Phases 1–4 |
| §6.3 Board snapshot shape | Done |
| §7.1 Ticket creation flow | Done — transactional, increments `ticket_seq`, watchers seeded |
| §7.2 Ticket transition + WIP limit + optimistic locking | Done — admin can bypass via `?override_wip=true` |
| §7.3 Optimistic locking via `If-Match` header | Done |
| §7.4 Permission service | Done — workspace + project member checks |
| §7.5 Activity log | Done — writes on every state change |
| §11 Web client — board, drawer, filters, create modal | Done |
| §11.3 Drag-and-drop with `@dnd-kit/core` | Done — optimistic UI + rollback on failure |
| §11.5 Accessibility — keyboard DnD, focus rings, escape closes drawer | Basic |
| §9 Slack — slash commands, interactivity, events handshake, signature verification | Done — single-service adaptation (see below) |
| §10.5 Due-date reminders with dedupe table | Done — plus user-set reminders with recurrence & snooze |
| §18 Tests — happy path, version conflict, WIP limit, admin bypass, activity log | Done — 55 vitest tests, hermetic SQLite |
| Goals (daily/weekly/monthly/yearly) & personal/professional contexts | Done — extension beyond the original spec |

## Deviations from the TechSpec

The spec describes a full enterprise architecture — five microservices, Kafka
event bus, Redis pub/sub, Slack OAuth, Postgres, Helm/EKS deploys. To produce
a runnable, end-to-end implementation in one pass, this build collapses those
into a single Next.js 14 application, with the following intentional
deviations. All can be reintroduced incrementally without changing the domain
model or API contract.

| Spec | This build | Reason / migration path |
| --- | --- | --- |
| Postgres 16 | SQLite (file) | Zero-setup for local dev. Schema is portable: switch `provider = "postgresql"` in `prisma/schema.prisma` and run `db push` against a Postgres URL. |
| NestJS api-gateway + core-service | Next.js Route Handlers under `src/app/api/v1/...` | Same URL paths, same DTOs, same error envelope. Lift-and-shift to NestJS controllers when needed. |
| Notification service (Go), Kafka | In-process: `notifications` table + polling bell UI + Slack DMs, driven by a 60s scheduler tick (`src/lib/jobs.ts`) | Same routing semantics without the Kafka hop; lift into a consumer when an event bus is introduced. |
| Slack connector (Go) | Next.js route handlers (`/api/v1/slack/*`) with §9.5 signature verification | Same webhook contract; commands execute in-process against the same service layer. OAuth install flow deferred — single-tenant env-token binding instead (`SLACK_BOT_TOKEN`). |
| WebSocket realtime | Polling fallback (TanStack Query refetches every 15s) | Same client-visible behavior at higher latency. Add a Redis-backed WS gateway when introduced. |
| NextAuth + JWT + magic link | Demo cookie session (`fb_user_id`) | Auth scaffolding is centralized in `src/lib/auth.ts` — swap in NextAuth without touching call sites. |
| OpenTelemetry, Pino, Prometheus | `console.error` for unhandled errors only | Drop-in via the shared logger seam in `src/lib/api.ts`. |
| Helm charts, Terraform, ECR, EKS, multi-env CD | A single CI workflow (lint, typecheck, test, build) | The CD layer in §23 of the spec is fully separable; CI gates are in place to support it. |

Anything in `Out of scope for v1` (§21) is also out of scope here.

## Project layout

```
src/
├── app/
│   ├── api/                    # REST routes — see TechSpec §6.2
│   │   ├── healthz, readyz
│   │   └── v1/
│   │       ├── auth/
│   │       ├── workspaces/
│   │       ├── projects/[id]/{board,columns,tickets}
│   │       ├── columns/[id]
│   │       └── tickets/[id]/{transitions,comments}
│   ├── workspace/[wid]/
│   │   ├── layout.tsx          # auth guard + sidebar
│   │   ├── page.tsx            # project list
│   │   ├── goals/page.tsx      # daily/weekly/monthly/yearly goals
│   │   ├── planner/page.tsx    # reminders — plan, snooze, reschedule
│   │   └── projects/[pid]/page.tsx
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                # landing + demo login
├── components/
│   ├── board/                  # Board, Column, TicketCard, Drawer, Filters, Modal
│   ├── goals/GoalsClient.tsx   # cadence tabs, period nav, progress bars
│   ├── planner/PlannerClient.tsx # reminder list, snooze, reschedule
│   ├── providers/QueryProvider.tsx
│   ├── DemoLoginButton.tsx
│   ├── NotificationBell.tsx    # unread badge + dropdown (polls /notifications)
│   └── Sidebar.tsx
├── instrumentation.ts          # arms the in-process job scheduler on boot
└── lib/
    ├── activity.ts             # activity_events writes (§7.5)
    ├── api.ts                  # JSON envelope, request IDs, zod parsing (§4.2)
    ├── auth.ts                 # session resolution (§4.5)
    ├── board.ts                # board snapshot loader (§6.3)
    ├── db.ts                   # Prisma singleton
    ├── errors.ts               # ApiError + status mapping (§4.2)
    ├── fractional-index.ts     # rank helpers (§5.4)
    ├── goals.ts                # goal CRUD + linked-ticket progress
    ├── ids.ts                  # ULID-prefixed IDs (§4.1)
    ├── jobs.ts                 # jobs tick: reminders + due-date scans (§10.5)
    ├── notifications.ts        # in-app notification writes/reads
    ├── periods.ts              # daily/weekly/monthly/yearly period keys (isomorphic)
    ├── permissions.ts          # PermissionService (§7.4)
    ├── reminders.ts            # reminder lifecycle: deliver, snooze, recur
    ├── slack.ts                # §9.5 signatures, command grammar, Web API client
    ├── slack-commands.ts       # /flowboard command execution
    └── tickets.ts              # createTicket, transitionTicket, updateTicket
```

## Slack usage

Once connected (see [`DEPLOYMENT.md`](./DEPLOYMENT.md) Step 5):

```
/flowboard create Fix login bug in FB p:high due:2026-08-01   # create a ticket
/flowboard create Book dentist ctx:personal                   # personal task
/flowboard move FB-12 to Done                                 # move a ticket
/flowboard list                                               # your open tickets
/flowboard remind in 30m Review the release PR                # set a reminder
/flowboard help
```

Reminder DMs arrive with **Snooze 15m / Snooze 1h / Done** buttons; moving a
ticket (from the web or Slack) DMs the reporter and assignees.

## Scripts

```
pnpm dev          # next dev
pnpm build        # prisma generate + next build
pnpm test         # vitest (unit + integration against tmp SQLite)
pnpm typecheck    # tsc --noEmit
pnpm lint         # next lint
pnpm db:push      # apply schema to SQLite
pnpm db:seed      # idempotent demo seed
pnpm db:reset     # wipe + reseed
```

## Tests

`vitest` runs 55 tests:

- `src/lib/fractional-index.spec.ts` — 8 unit tests for the rank helper
- `src/lib/tickets.spec.ts` — 7 integration tests against a hermetic SQLite
  DB created via `prisma db push`. Covers creation, transition, WIP-limit
  rejection, admin bypass, version conflict (TechSpec §18.2's required
  scenarios for the ticket flow), and activity-log emission.
- `src/lib/periods.spec.ts` — 12 unit tests: period keys across timezones,
  ISO-week year boundaries, shifting, validation.
- `src/lib/slack.spec.ts` — 17 unit tests: HMAC signature verification
  (tamper, replay window, missing headers) and the `/flowboard` grammar.
- `src/lib/goals-reminders.spec.ts` — 11 integration tests: goal CRUD +
  linked-ticket progress, reminder deliver/snooze/recurrence/reschedule,
  due-date scan dedupe.

## Deployment

The repo ships with a GitHub Actions release pipeline that publishes a
production-ready container image to **GitHub Container Registry (GHCR)** —
zero secrets to configure, the built-in `GITHUB_TOKEN` is enough.

> **For step-by-step deployment instructions, see [`DEPLOYMENT.md`](./DEPLOYMENT.md).**
> This section covers the pipeline architecture; the runbook covers the operator-facing actions.

### Pipeline

| Workflow | File | Trigger | Result |
| --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | every PR + push to `main` | lint, typecheck, vitest, `pnpm build`, **Docker build + container smoke test** (no push) |
| Release | `.github/workflows/release.yml` | push to `main`, semver tag `v*.*.*`, manual dispatch | runs the test gate, then builds a multi-arch (`linux/amd64`,`linux/arm64`) image and pushes to `ghcr.io/<owner>/flow-board` with provenance + SBOM. Tags create a GitHub Release with auto-generated notes. |

Image tags follow TechSpec §23.6:

- `main` and `main-<sha7>` for every commit on `main`
- `latest` for the default branch and for any semver tag
- `v1.4.2`, `1.4.2`, `1.4`, `1` for tag pushes (major-only suppressed for `v0.x`)
- `manual-<run_id>` for `workflow_dispatch`

### Run anywhere `docker run` runs

```bash
docker run -d \
  --name flowboard \
  -p 3000:3000 \
  -v flowboard-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/wankhede04/flow-board:latest
```

Or with the supplied compose file:

```bash
docker compose up -d
```

The image:

- runs as a non-root `nextjs` user (uid 1001)
- listens on `:3000` and exposes `/api/healthz`, `/api/readyz`
- persists data at `/data/flowboard.db` (SQLite); mount a volume there
- runs `prisma db push` on every boot — idempotent and forward-compatible
  per TechSpec §23.8
- has a Docker `HEALTHCHECK` that hits `/api/healthz`

### Required environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Defaults to `file:/data/flowboard.db`. Switch to a Postgres URL and update `provider` in `prisma/schema.prisma` for multi-replica deploys. |
| `JWT_SECRET` | Required in production. Use `openssl rand -hex 32`. |
| `APP_BASE_URL` | Public URL of the deployment — used in Slack replies and notification links. |
| `SLACK_SIGNING_SECRET` | Enables the `/flowboard` command + interactivity + events endpoints (optional). |
| `SLACK_BOT_TOKEN` | `xoxb-` token for outbound DMs — reminders and ticket-move notifications (optional). |
| `ENABLE_SCHEDULER` | Default `true`: in-process 60s jobs tick. Set `false` on multi-replica/serverless and use external cron. |
| `CRON_SECRET` | Bearer secret for `POST /api/v1/jobs/tick` (external cron mode). |

### Cutting a release

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

The Release workflow then:

1. Runs the test gate (lint, typecheck, vitest)
2. Builds and signs a multi-arch image, pushes to GHCR with SBOM + provenance attestation
3. Creates a GitHub Release with auto-generated changelog

### Migrating to TechSpec §23 (ECR + EKS)

The Release workflow is a near-drop-in for the spec's `_build-and-push.yml`.
To switch from GHCR to ECR + EKS:

1. Add an OIDC role + secrets per TechSpec §23.4
2. Replace the `docker/login-action` step with `aws-actions/configure-aws-credentials` + `amazon-ecr-login`
3. Add a `migrate` job that runs `helm upgrade --install flowboard-migrate ...` between the publish and deploy steps (§23.7)

The `Dockerfile` and `docker-compose.yml` are infra-agnostic and unchanged.

## API examples

```bash
# Sign in (sets fb_user_id cookie)
curl -i -X POST http://localhost:3000/api/v1/auth/demo-login

# List workspaces for current user
curl --cookie "fb_user_id=<id>" http://localhost:3000/api/v1/workspaces/me

# Board snapshot (TechSpec §6.3 shape)
curl --cookie "fb_user_id=<id>" \
  http://localhost:3000/api/v1/projects/<projectId>/board

# Move a ticket (optimistic locking via If-Match)
curl -X POST http://localhost:3000/api/v1/tickets/<ticketId>/transitions \
  -H "Content-Type: application/json" \
  -H "If-Match: 1" \
  --cookie "fb_user_id=<id>" \
  -d '{"targetColumnId":"<colId>","targetIndex":0}'

# Goals for the current week
curl --cookie "fb_user_id=<id>" \
  "http://localhost:3000/api/v1/workspaces/<wid>/goals?cadence=weekly&period=2026-W28"

# Create a goal
curl -X POST "http://localhost:3000/api/v1/workspaces/<wid>/goals" \
  -H "Content-Type: application/json" --cookie "fb_user_id=<id>" \
  -d '{"title":"Ship the release","cadence":"weekly","context":"professional"}'

# Set a reminder (ISO time; adjust later with PATCH {"remindAt": ...} or {"snoozeMinutes": 15})
curl -X POST "http://localhost:3000/api/v1/workspaces/<wid>/reminders" \
  -H "Content-Type: application/json" --cookie "fb_user_id=<id>" \
  -d '{"title":"Prep standup","remindAt":"2026-07-09T08:45:00.000Z","recurrence":"daily"}'

# Unread notifications
curl --cookie "fb_user_id=<id>" "http://localhost:3000/api/v1/notifications?unread=true"

# Run the jobs tick manually (external-cron mode)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/v1/jobs/tick
```

Errors follow the spec's envelope:

```json
{
  "error": { "code": "WIP_LIMIT_EXCEEDED", "message": "...", "details": { "wip_limit": 3 } },
  "request_id": "req_01HXYZ..."
}
```
