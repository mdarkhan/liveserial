# PROGRESS

Read [docs/BRIEF.md](docs/BRIEF.md) (requirements) and [docs/PLAN.md](docs/PLAN.md) (architecture + decisions) first.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Plan | **Approved** (2026-11-10) | Owner chose embedded Postgres for local dev. |
| 1 — Foundation | **Done, awaiting owner review** (2026-11-10) | See "Phase 1" below. |
| 2 — Queue engine | Not started | |
| 3 — Live view | Not started | |
| 4 — ETA and SMS | Not started | |
| 5 — Admin and deploy | Not started | |

## How to run (local)

```bash
npm install
npm run db:start          # terminal 1: embedded Postgres on :5433 (data in ./.pgdata), creates liveserial + liveserial_test
npx prisma migrate dev    # apply migrations to the dev DB
npm run db:seed           # demo data (prints logins + a patient link)
npm run dev               # http://localhost:3000
npm test                  # unit + integration (integration needs db:start running)
npm run typecheck && npm run lint
```

Copy `.env.example` to `.env` first (a dev `.env` already exists locally; it is git-ignored).

Demo logins (dev only, from `prisma/seed.ts` / `.env`):

| Role | Phone | Password |
|---|---|---|
| Super admin | 01700000000 | value of `SEED_SUPERADMIN_PASSWORD` in `.env` |
| Clinic admin | 01711000001 | demo1234 |
| Assistant | 01711000002 | demo1234 |
| Doctor (Dr. Karim) | 01711000003 | demo1234 |

## Phase 1 — what exists

- Next.js 16.4 App Router, TS strict, Tailwind 4, Hind Siliguri via `next/font`, all UI strings in `src/lib/i18n/bn.ts`.
- Prisma 7 schema + first migration, including hand-written guards: append-only `QueueEvent` trigger, one now-serving token per session, one automatic SMS per trigger per token, CHECK constraints.
- Better Auth (phone + password, DB sessions, login rate limit, deactivated users/orgs blocked, sessions revoked on deactivation or password reset).
- Role routing: super admin → `/super`, clinic admin → `/admin`, assistant/doctor → `/console`. `src/proxy.ts` gates by cookie; every page/action re-checks role + org server-side.
- Super admin: list organizations, create organization + first admin, activate/deactivate.
- Clinic admin: doctors, chambers (with "leave now" threshold), schedules, users (create, link to doctor, reset password, deactivate), sessions (by date, create, cancel), tokens (quick add, edit, cancel) with an audit log on the session page.
- `src/lib/queue-service.ts`: every token/session change runs in one transaction — session row lock → idempotency check (`ClientRequest`) → change → `QueueEvent` → `queueVersion++` → `pg_notify` → store response.
- `/console`: read-only list of today's sessions (the real console is Phase 2).

## Decisions (Phase 1)

1. **Open questions 3–7 answered with my defaults** (owner answered only Q1): any assistant can run any session in their org; doctors get read-only access to their own sessions; the display screen will be public via the unguessable session link; out-of-order reasons as proposed; phone is optional. Q2 (FlyNode pooler) and Q8 (domain) are still open; they matter in Phases 3–5.
2. **Cache Components turned off** (`cacheComponents: false`). Next 16.4 enables it by default in new apps; every page here is live per-user data, so the classic dynamic model is simpler. Root layout sets `dynamic = "force-dynamic"`.
3. **Times are written as Bangla day-period + 12h** ("বিকাল ৫:০০") with our own formatter, because `Intl` in `bn-BD` prints "PM" in English.
4. **Integration tests never reset the DB.** Each test creates its own organization; global setup runs `prisma migrate deploy` (non-destructive). Prisma 7 refuses `migrate reset` when run by an AI agent without explicit consent, and a reset isn't needed anyway.
5. Admin forms are Server Actions with a hidden client request id (`rid`) for token/session changes, so a double-submit is applied once.
6. Admin token management lives on `/admin/sessions/[id]`; on phones the add-patient form is first on the page (also first in DOM / tab order).
7. Icons: none needed yet; plain text + `←`. Will add a few inline SVGs in Phase 2 rather than an icon package.
8. `.claude/launch.json` committed (dev-server config for the desktop app preview).

## Known issues / notes

- Dev machine (Windows 10) has no Docker / psql; `npm run db:start` (embedded-postgres) is the local DB. Keep it running in its own terminal.
- npm `latest` for `prisma` is an 8.0 RC; we pin 7.10.1. TypeScript pinned to 5.9.3.
- Patient links (`/t/...`) shown on the admin session page 404 until Phase 3.
- `npm run db:reset` is destructive (drops the dev DB); Prisma will ask for confirmation.
- No git remote configured. Don't push without asking.
