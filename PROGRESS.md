# PROGRESS

Read [docs/BRIEF.md](docs/BRIEF.md) (requirements) and [docs/PLAN.md](docs/PLAN.md) (architecture + decisions) first.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Plan | **Approved** (2026-11-10) | Owner chose embedded Postgres for local dev. |
| 1 — Foundation | **Approved** (2026-11-10) | See "Phase 1" below. |
| 2 — Queue engine | **Approved** (2026-11-10) | See "Phase 2" below. |
| 3 — Live view | **Done, awaiting owner review** (2026-11-10) | See "Phase 3" below. |
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

## Phase 2 — what exists

- `src/lib/queue.ts` (pure, unit-tested): next-to-call, now-serving, jumped serials (out-of-order detection), people ahead, re-queue position, session status transitions, bulk-list parser, public codes, request ids.
- `src/lib/queue-service.ts`: `callNext`, `callToken` (out of order needs a reason; OTHER needs a note; jumped serials recorded), `tokenAction` (IN_CONSULT / DONE / SKIP / NO_SHOW), `requeue` (after current / at end), `setDoctorStatus` (arrived / break / resume / end), `setDelay`, plus add / edit / cancel. All in one locked, idempotent transaction with `QueueEvent`s.
- `POST /api/sessions/[id]/queue` (one JSON endpoint for every console action) and `GET` (the console view). Doctors: GET only, own sessions only.
- `/console`: today + the next 7 days; shows existing sessions and scheduled sittings; tapping a scheduled sitting creates its session (idempotent).
- `/console/[id]`: the assistant console — now-serving card, 72px "পরের রোগী ডাকুন" bar in the thumb zone with "পরবর্তী: সিরিয়াল N", doctor-status buttons, "দেরি হবে" (before the doctor arrives), waiting / away lists with a bottom sheet per patient (call now, skip, re-queue, cancel, tap-to-call phone), out-of-order reason sheet, quick add and bulk add with live preview. Read-only for doctors.
- Admin session page: out-of-order calls highlighted (reason, note, jumped serials); link to the console.

### Verified in the browser (360px)
Arrived → next → next → "ভিতরে গেছেন" → emergency call out of order (reason pre-filled, jumped list shown) → skip → no-show → re-queue after current → next calls the re-queued patient → bulk add (bad line blocked) → delay → lazy session creation. Simulated: a second assistant advancing first (stale tap refused, warning shown, nobody skipped); two network failures (same request id retried, applied once); a lost response after the server applied the action (retry replayed, exactly one advance); network down for all retries (red "সেভ হয়নি" banner, retry succeeds). No tap target under 48px; no horizontal scroll.

## Decisions (Phase 2)

1. **One tap per patient.** "Next" finishes whoever is inside and calls the next one (CALLED = now serving). "ভিতরে গেছেন" is optional and only improves timing data.
2. **Double-call guard:** the client sends the now-serving token it was showing; the server compares under the session row lock. 20 concurrent taps → exactly 1 call (integration-tested).
3. **No optimistic updates.** Actions queue on the phone in order, retry with backoff (6 attempts, ~30 s) using the same request id, then show a red "সেভ হয়নি" banner with retry / discard. The big button is disabled while a call-type action is unsent; adding patients can still queue. Closing the tab with unsent actions asks for confirmation.
4. **No-show doesn't auto-call the next patient**; the assistant taps next (one predictable rule).
5. **Ending a session** finishes the patient inside; patients still waiting stay WAITING (reported as not seen).
6. **Calling the patient who is next anyway** is logged as a normal call, not out of order.
7. **Emergency flag pre-selects the "জরুরি" reason**; it never jumps the queue on its own.
8. **"দেরি হবে" is offered only before the doctor arrives.** It sets the announced delay used by ETA in Phase 4; the delay SMS broadcast is Phase 4.
9. **Console refresh is a 10 s poll for now.** Phase 3 replaces it with SSE + LISTEN/NOTIFY and keeps polling as the fallback.
10. **Out-of-order reasons** as proposed in Phase 0 (no change requested).
11. Next's dev badge turned off (it covered the big button). Dev preview pinned to port 3002 in `.claude/launch.json`.

## Phase 3 — what exists

- `src/lib/snapshot.ts`: a session is loaded once per change, then projected per viewer: console (staff), display (serials only), patient (own serial + position only). Unit tests assert the public views contain no names, phones or other patients' links.
- `src/lib/realtime.ts`: one `LISTEN liveserial` connection per instance (`DIRECT_DATABASE_URL` if set, else `DATABASE_URL`), coalesced reloads, 60 s refresh, reconnect with backoff; SSE helper with `ping` events every 20 s.
- Routes: `/api/live/session/[id]?view=console|display`, `/api/live/t/[code]`; `?once=1` returns JSON for the polling fallback.
- `src/lib/use-live.ts`: SSE in the browser; falls back to polling every 15 s if the stream errors or goes quiet for 45 s; retries SSE every 2 min.
- `/t/[publicCode]`: patient page — server-rendered first view, doctor/chamber/date, session banner ("ডাক্তার এখনো আসেননি" + scheduled time + announced delay), now serving, your serial, people ahead, "এখন রওনা দিন", "লাইভ / সর্বশেষ আপডেট". `noindex`, `no-referrer`. Bangla 404 for unknown links.
- `/display/[sessionId]`: waiting-room screen (landscape and portrait), now serving + next three, clock, keeps the screen awake where supported.
- Console uses the same live stream (replacing the Phase 2 poll). Admin session page links to the display.

### Verified
- `curl` on a patient stream: an update arrived ~0.3 s after "next".
- Playwright e2e (`npm run test:e2e`, Edge, 360px): 4/4 pass — console next; patient page updates within 5 s without reload and shows no other names; out-of-order call needs a reason and appears highlighted in the admin audit log with reason + jumped serials; display shows now serving + next three.
- Visual checks: patient page at 360px, display at 1280×720 and 768×1024 (live update observed without reload).

## Decisions (Phase 3)

1. Display access = the session's random UUID in the link (no login), as proposed; it shows serial numbers and doctor/chamber name only.
2. "People ahead" counts the patient inside; "এখন রওনা দিন" shows when people ahead ≤ the chamber threshold and the patient is waiting.
3. The patient page has no JS-free auto-refresh (React would hoist a `<noscript>` meta refresh into `<head>` and refresh everyone); instead the server-rendered page is complete and a `<noscript>` link reloads it.
4. ETA ranges are NOT on the patient page yet — they come with the ETA engine in Phase 4.
5. E2E uses the installed Microsoft Edge (`channel: "msedge"`) so no browser download is needed; it runs `next build` then `next start` on port 3100 against `liveserial_test`, and creates its own clinic each run.
6. `DIRECT_DATABASE_URL` (optional) is read for LISTEN. It is NOT yet in `.env.example`: edits to env files are blocked by the local permission settings — add this line by hand:
   `# DIRECT_DATABASE_URL="postgresql://user:pass@host:5432/liveserial"  (only if DATABASE_URL goes through a transaction-mode pooler)`

## Known issues / notes

- Dev machine (Windows 10) has no Docker / psql; `npm run db:start` (embedded-postgres) is the local DB. Keep it running in its own terminal.
- npm `latest` for `prisma` is an 8.0 RC; we pin 7.10.1. TypeScript pinned to 5.9.3.
- The admin session page shows the last 30 audit events; full daily reports are Phase 5.
- Dev only: if the dev server hot-reloads while a form is submitted, the server action can be missed (seen once on login, during a hot reload). Believed to be dev-only; not yet checked against a production build.
- `npm run db:reset` is destructive (drops the dev DB); Prisma will ask for confirmation.
- No git remote configured. Don't push without asking.
- `next start` warns that it "does not work with output: standalone"; it works for the e2e run. The Phase 5 Dockerfile will use `node .next/standalone/server.js` as Next recommends.
- SSE connections are not rate-limited per IP yet (public links are unguessable: ~57.8-bit codes / UUIDs). Revisit before launch if needed.
