# LiveSerial — Phase 0 plan

Status: **approved 2026-11-10** (local DB: embedded-postgres). Later changes are logged in PROGRESS.md. Source requirements: [BRIEF.md](BRIEF.md).
Schema: [../prisma/schema.prisma](../prisma/schema.prisma) (validated with Prisma 7.10.1).

---

## 1. Stack and pinned versions

| Piece | Version | Note |
|---|---|---|
| Next.js (App Router) | 16.4.x | `output: "standalone"` for Docker. Route gating in `src/proxy.ts` (Next 16's name for middleware). |
| React | 19.x | |
| TypeScript | 5.9.3, `strict` | TS 7 (native compiler) is out, but I won't assume Next's tooling is happy with it yet. |
| PostgreSQL + Prisma | Prisma **7.10.1** + `@prisma/adapter-pg` | npm's `latest` tag for Prisma currently points at 8.0 **RC**, so I pin 7.x stable. Prisma 7 needs no Rust engine binary → smaller image. |
| `pg` | 8.x | Only for the dedicated `LISTEN` connection (and Prisma's adapter). |
| Tailwind CSS | 4.x | CSS-first config, tokens in `globals.css`. |
| Auth | **Better Auth 1.7** | See §2. |
| Tests | Vitest + Playwright 1.65 | |
| Font | Hind Siliguri via `next/font/google` (self-hosted at build time) | |

## 2. Auth: Better Auth

**Why (one line):** maintained, first-class Prisma adapter, built-in phone-number + password sign-in (`phoneNumber` plugin), database sessions we can revoke when an assistant leaves, and built-in login rate limiting — Auth.js's Credentials provider is JWT-only and officially discouraged.

How it's used:
- Users never self-register. ORG_ADMIN creates users (name, phone, role, temporary password); SUPER_ADMIN creates an organization plus its first ORG_ADMIN.
- Better Auth requires a unique email, so login-by-phone users get a placeholder `8801XXXXXXXXX@phone.invalid`.
- `role`, `organizationId`, `isActive` are Better Auth `additionalFields` (not user-settable). Deactivated users are refused at sign-in and their sessions are deleted.
- Its session table is renamed `AuthSession` so it doesn't collide with our chamber `Session`.
- The phone plugin's OTP sender is required by the API; it's wired to a no-op because we don't use OTP in the MVP.

## 3. Folder structure (kept flat on purpose)

```
prisma/
  schema.prisma
  migrations/            # first migration includes the raw-SQL guards (see schema header)
  seed.ts                # 1 org, 2 doctors, 1 chamber, users for every role, 1 session × 25 tokens
prisma.config.ts
src/
  proxy.ts               # redirect to /login when no auth cookie (real checks happen server-side)
  instrumentation.ts     # starts the LISTEN client and the SMS outbox sweeper
  app/
    layout.tsx, globals.css
    page.tsx             # redirect by role
    login/page.tsx
    console/page.tsx                 # assistant home: today's sittings
    console/[sessionId]/page.tsx     # assistant console (+ console-client.tsx)
    admin/…/page.tsx                 # doctors, chambers, schedules, users, sessions, reports
    super/…/page.tsx                 # organizations, create org, SMS usage
    t/[publicCode]/page.tsx          # patient page (SSR + tiny live island)
    display/[sessionId]/page.tsx     # waiting-room TV
    api/
      auth/[...all]/route.ts         # Better Auth
      sessions/[id]/queue/route.ts   # POST: every queue action (JSON, idempotent)
      live/session/[id]/route.ts     # SSE for console + display
      live/t/[code]/route.ts         # SSE for patient
      state/…/route.ts               # same payloads as JSON, for the 15 s polling fallback
  lib/
    db.ts            # Prisma client (singleton)
    auth.ts, auth-client.ts
    access.ts        # requireUser / requireRole / org scoping helpers
    queue.ts         # PURE rules: pick next, people ahead, allowed transitions, re-queue order
    queue-service.ts # transactions: lock, validate, apply, log QueueEvent, outbox SMS, NOTIFY, idempotency
    snapshot.ts      # read models: console view, display view, patient view
    eta.ts           # PURE ETA + range formatting
    realtime.ts      # LISTEN connection + in-process fan-out
    sms.ts           # SmsProvider, ConsoleSmsProvider, templates, segment counter, outbox sender
    format.ts        # Bangla digits, Asia/Dhaka dates, BD phone normalization
    i18n/bn.ts       # every UI string (English can be added as en.ts later)
  components/        # a handful of shared UI pieces (Button, Card, StatusPill, ConfirmDialog…)
tests/
  unit/              # queue.ts, eta.ts, sms segments, format — every ETA branch
  integration/       # queue-service against real Postgres: concurrency, idempotency, tenant isolation
  e2e/               # Playwright, 360 px viewport
Dockerfile, .env.example, README.md, PROGRESS.md
```

Mutations: **queue actions** go through one JSON route handler (the client controls retries, request IDs and 409 handling explicitly); **admin CRUD** uses Server Actions (plain forms, less code).

## 4. Data model notes (beyond the brief)

- **Tenancy:** every tenant table has `organizationId`; `access.ts` returns the caller's org and every query filters on it. No Postgres RLS in the MVP (too much machinery for one app). An integration test asserts that org A's user gets 404 for org B's session/token.
- **Session id** is a random UUID v4, so `/display/[sessionId]` is unguessable.
- **Sessions are created lazily from ScheduleTemplates.** The console lists today's (and up to 7 days ahead, for phone bookings) sittings from active templates; opening one creates the `Session` row (idempotent via `@@unique([doctorId, scheduledStartAt])`). Admins can also create an ad-hoc session.
- **`queueOrder`** is separate from `serial`, because re-queue must move a patient without changing the number they were told. Default = serial; "after current patient" = min(waiting) − 1; "at end" = max + 1. "Next" = lowest `queueOrder`, then `serial`.
- **Token `CANCELLED`** status added for entries made by mistake. Nothing is hard-deleted.
- **`QueueEvent`** is append-only (DB trigger). Out-of-order calls set `isOutOfOrder`, `reason`, optional `note`, and `meta.jumpedSerials` (who was skipped over), which is what the report highlights.
- **`ClientRequest`** table for idempotency (see §5).
- **`SmsMessage`** doubles as the outbox and the billing log; a partial unique index guarantees each automatic trigger fires at most once per token (3 templates → max 3 automatic SMS).

## 5. Queue engine

Every queue action runs in one Prisma interactive transaction:

1. `INSERT INTO "ClientRequest"(id, …)` — if the id already exists, return its stored `response` and stop (retry on flaky 3G is a no-op).
2. `SELECT … FROM "Session" WHERE id = $1 AND "organizationId" = $2 FOR UPDATE` — serializes all changes to one session.
3. Validate with pure rules from `queue.ts`.
4. Apply token/session updates; `queueVersion += 1`.
5. Write `QueueEvent` row(s).
6. Evaluate SMS triggers for affected tokens → insert `SmsMessage` rows (QUEUED).
7. `SELECT pg_notify('liveserial', '{"s":"<sessionId>","v":<queueVersion>}')`.
8. Store the response in `ClientRequest`; commit.

**"Next" never double-calls or skips:** the client sends `expectedCurrentTokenId` (the now-serving token it was showing, or null). Under the row lock the server compares it with the real now-serving token; if they differ, someone else already advanced → `409` with the fresh state, and the UI says "১২ নম্বর ইতিমধ্যে ডাকা হয়েছে". So two assistants tapping together produce exactly one call. Backstop: a partial unique index allows only one CALLED/IN_CONSULT token per session.

**Next** = current CALLED/IN_CONSULT → DONE, first WAITING → CALLED. If the session was NOT_STARTED/DOCTOR_ARRIVED it becomes RUNNING (and `doctorArrivedAt` is set if missing — logged). ON_BREAK → RUNNING. ENDED/CANCELLED → rejected.

**One tap per patient.** `CALLED` = now serving. An optional small "ভিতরে গেছেন" button sets `IN_CONSULT`; consultation time = `completedAt − (consultStartedAt ?? calledAt)`.

**Other actions:** call out of order (WAITING token not first in line; reason required; pre-filled EMERGENCY if the token is flagged), skip (WAITING → SKIPPED), no-show (CALLED → NO_SHOW), re-queue (SKIPPED/NO_SHOW → WAITING, after current or at end), mark done, cancel, edit name/phone, add (quick), bulk add, session status changes, set delay, delay broadcast. All go through the same 8 steps.

**Bulk add:** paste one patient per line: `[serial] name [phone]`. A leading number is the serial (for phone bookings already numbered); otherwise the next free one. Phone is detected by pattern; Bangla or English digits both accepted. Preview with errors before saving.

**Assistant UI on bad networks:** actions are queued client-side in order, each with its UUID, retried with backoff, with a visible saved / syncing / failed state. No optimistic queue changes — the server is the truth; the button shows "সেভ হচ্ছে…" until confirmed.

## 6. Live updates: SSE + Postgres LISTEN/NOTIFY

```
assistant taps → POST /api/sessions/:id/queue → transaction … pg_notify('liveserial', {s, v}) → COMMIT
                                                                     │  (delivered only on commit, in commit order)
         every app instance: one dedicated pg.Client  LISTEN liveserial
                                                                     │
                       in-process map  sessionId → Set<subscriber>   │
                                                                     ▼
                    load snapshot ONCE per session per change (coalesced if changes arrive mid-load)
                                                                     │
              project per subscriber: console (full list) · display (now + next 3) · patient (own token only)
                                                                     ▼
                                          SSE  `data: {...,"v":42}`  → browser EventSource
```

- NOTIFY is transactional, so rolled-back actions never broadcast, and every instance hears every commit — works unchanged with more than one instance.
- The payload is tiny (session id + version); the data is read from the DB, never trusted from the notification. Clients drop any message with a lower `v` than they have.
- SSE route handlers (`runtime = "nodejs"`, dynamic): `retry: 3000`, heartbeat comment every 20 s, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, cleanup on `request.signal` abort.
- The LISTEN client reconnects with backoff; after reconnecting it pushes a fresh snapshot to everyone (they may have missed changes).
- While a session has subscribers and the doctor hasn't arrived, the server re-sends the snapshot every 60 s so the time-based ETA keeps moving.
- **Fallback:** if EventSource errors out, or nothing (not even a heartbeat) arrives for 45 s, the client polls the `/api/state/…` JSON every 15 s and retries SSE every 2 min. A `<noscript><meta http-equiv="refresh" content="30"></noscript>` covers phones with JS off.
- Patient page: first view is server-rendered from the same snapshot function; the live part is one small client component. I'll measure first-load JS in Phase 3; if it's too heavy for 3G, the escape hatch is serving that page as plain HTML + ~2 KB vanilla JS from a route handler.
- **Requirement on hosting:** LISTEN needs a real session connection. If FlyNode's DATABASE_URL goes through PgBouncer in transaction mode, I'll add a `DIRECT_DATABASE_URL` for the listener (see open question 2).

## 7. ETA (Phase 4, rules decided now)

- **People ahead** = WAITING tokens ahead of you in queue order **+ 1 if someone is currently being served**. So "আপনার আগে ১ জন" means you're next, which lines up with the "people ahead = 1" SMS.
- Minutes per consultation, arrival rule, and the 6-minute default exactly as the brief says. "Running late by N" (`announcedDelayMinutes`) overrides the historical arrival delay.
- **Range:** low = ETA rounded down to 5; high = (ETA × 1.3) rounded up to 5; at least 10 minutes wide. E.g. 32 min → "৩০–৪৫ মিনিট". Under 5 min → "কিছুক্ষণের মধ্যে".
- ON_BREAK: ETA computed as if running, plus a prominent "ডাক্তার বিরতিতে" notice.
- Every branch unit-tested with an injected clock.

## 8. SMS (Phase 4)

- `SmsProvider { send(to, body): Promise<{ id } | { error }> }`; `ConsoleSmsProvider` logs to stdout. Choice by `SMS_PROVIDER` env.
- Outbox: rows are inserted as QUEUED inside the queue transaction, sent right after commit, and a sweeper (every 30 s, `FOR UPDATE SKIP LOCKED`, safe with several instances) retries leftovers up to 3 times.
- Triggers fire when people ahead **drops to ≤** the value (not exact equality), because an out-of-order call or cancellation can jump from 6 to 4. A trigger already satisfied when the token is created is suppressed (the creation SMS covers it). Tokens without a phone get no SMS.
- Segment counter: GSM-7 160/153, Unicode 70/67. Shown in the delay-broadcast confirm dialog (recipients × segments) and anywhere templates are edited.

## 9. Roles

| | SUPER_ADMIN | ORG_ADMIN | DOCTOR | ASSISTANT |
|---|---|---|---|---|
| Organizations, SMS usage (all orgs) | ✔ | | | |
| Doctors, chambers, schedules, users | | ✔ | | |
| Reports | | ✔ (org) | ✔ (own) | |
| Assistant console | | ✔ | read-only (own) | ✔ (any session in org) |

(See open questions 3 and 4.)

## 10. Verification per phase

- `tsc --noEmit`, ESLint, Vitest every phase.
- Integration tests run against a real Postgres: 20 parallel "next" calls with the same `expectedCurrentTokenId` → exactly one succeeds; same `clientRequestId` replayed → applied once; cross-tenant access → 404.
- Playwright at 360 × 800: (1) assistant logs in, taps next, sees now-serving change; (2) patient page updates within 5 s of a tap; (3) out-of-order call with reason appears highlighted in the report.
- Docker image built and started against Postgres before Phase 5 is called done.

## 11. Decisions (made under "simplest reasonable reading")

1. Better Auth with placeholder emails; its session model renamed `AuthSession`.
2. Added token status `CANCELLED`; nothing is hard-deleted.
3. `queueOrder` separate from `serial` for re-queueing.
4. "Next" guarded by row lock **and** `expectedCurrentTokenId`; one-tap call with optional "entered" tap.
5. Tapping "next" on a not-started session marks the doctor arrived (logged).
6. Emergency flag is a marker, not automatic priority; calling an emergency token early is an out-of-order call with reason pre-filled.
7. Sessions created lazily from schedule templates, up to 7 days ahead.
8. People-ahead counts the patient currently inside.
9. SMS triggers fire on "≤", deduplicated by DB index; outbox pattern.
10. ETA range = [floor5(ETA), ceil5(1.3 × ETA)], min width 10.
11. Tenant isolation by explicit scoping + tests, not RLS.
12. Console shows Bangla digits too; all inputs accept Bangla or English digits.
13. Prisma 7.10.1 and TypeScript 5.9.3 pinned (newer tags are RC / unproven with Next).

## 12. Open questions

1. **Local database.** This machine has no Docker and no `psql`. For dev and the integration/e2e tests I need Postgres. Options: **(a, recommended)** the `embedded-postgres` npm dev dependency — downloads a real Postgres binary, zero install, used only locally; (b) you install PostgreSQL 17 for Windows; (c) a dev database on FlyNode.
2. **FlyNode Postgres connection.** Is the provided `DATABASE_URL` a direct connection, or behind a pooler (PgBouncer transaction mode)? LISTEN needs a direct/session connection.
3. **Assistant scope.** Can any assistant run any session in their organization (my default), or should assistants be assigned to specific doctors?
4. **Doctor login.** Read-only console + own reports (my default), or should doctors also be able to call patients?
5. **Display screen access.** Public via the unguessable link, no login (my default — it shows serial numbers and the doctor's name only), or must the TV log in?
6. **Out-of-order reasons.** Proposed list: জরুরি · দেরিতে এসেছেন · রিপোর্ট দেখানো · বয়স্ক / প্রতিবন্ধী · অন্যান্য (with a note). Change?
7. **Phone optional?** I'm allowing tokens without a phone (walk-ins without a mobile; no SMS for them). OK?
8. **Production domain** (not blocking): the patient link sits inside a 70-character Unicode SMS segment, so a short domain keeps each message to 1 segment. Do you have one in mind?
