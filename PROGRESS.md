# PROGRESS

Read [docs/BRIEF.md](docs/BRIEF.md) (requirements) and [docs/PLAN.md](docs/PLAN.md) (architecture + decisions) first.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Plan | **Approved** (2026-11-10) | Owner chose embedded Postgres for local dev. |
| 1 — Foundation | **Approved** (2026-11-10) | See "Phase 1" below. |
| 2 — Queue engine | **Approved** (2026-11-10) | See "Phase 2" below. |
| 3 — Live view | **Approved** (2026-11-10) | See "Phase 3" below. |
| 4 — ETA and SMS | **Approved** (2026-11-10) | See "Phase 4" below. |
| 5 — Admin and deploy | **Done, awaiting owner review** (2026-11-10) | See "Phase 5" below. Deployed to FlyNode 2026-11-10 (see "Deployment"). |
| 6 — Optional UX features | **Done, awaiting owner review** (2026-11-10) | See "Phase 6" below. Not deployed yet. |
| 7 — Break timer, not coming, SMS cost/limit | **Done, awaiting owner review** (2026-11-10) | See "Phase 7" below. Not deployed yet. |

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

## Phase 4 — what exists

- `src/lib/eta.ts` (pure): minutes per consultation (session median of last 10 → doctor's 30-session median → 6 min), arrived vs not-arrived formulas, range rounding. 18 unit tests cover every branch.
- Doctor history (`getDoctorStats` in `snapshot.ts`): median consultation and median arrival delay over the doctor's last 30 sessions, cached 10 min per doctor.
- Patient page shows "আনুমানিক অপেক্ষা: ১৫–২৫ মিনিট" (or "যেকোনো সময় ডাক পড়তে পারে"), with an "approximate" note and, before the doctor arrives, "ডাক্তার আসার পর হিসাব আরও ঠিক হবে।". The live hub re-sends every 60 s, so time-based estimates keep moving.
- `src/lib/sms-text.ts` (browser-safe): Bangla templates with Bangla digits, patient link, GSM-7 / Unicode segment counter.
- `src/lib/sms.ts`: `SmsProvider` interface, `ConsoleSmsProvider`, outbox sender (claim QUEUED → SENDING with `FOR UPDATE SKIP LOCKED`, retry after 20 s, max 3 attempts, permanent errors not retried, stuck SENDING rows reclaimed after 2 min), 30 s sweeper.
- Migration `sms_outbox_sending`: `SmsStatus.SENDING`, `SmsMessage.lastAttemptAt` (new migration; earlier ones untouched).
- Triggers inside the queue transaction: creation SMS on add; "leave now" when people ahead drops to ≤ the chamber threshold; "you're next" when it drops to ≤ 1. Max 3 automatic SMS per token, never the same trigger twice (DB index + `ON CONFLICT DO NOTHING`).
- Delay broadcast: console button "দেরির SMS পাঠান" → pick minutes → preview of a real message + "প্রাপক: N জন · প্রতি SMS: S অংশ · মোট: T অংশ" → confirm. Logged as `DELAY_BROADCAST` with recipients and segments; also sets the announced delay if the doctor hasn't arrived.

### Verified
- Unit 73/73, integration 38/38 (triggers incl. out-of-order jumps, dedupe, walk-ins, outbox send/retry/permanent failure, broadcast), e2e 5/5 (adds ETA on the patient page and the broadcast dialog counts).
- Browser at 360px: broadcast dialog (17 recipients, 2 segments each, 34 total) → 17 SMS printed by the console provider, each with its own link; patient page ETA "১৫–২৫ মিনিট".
- Seed on a fresh scratch database: 23 creation SMS SENT (2 walk-ins without phone got none); scratch DB dropped.

## Decisions (Phase 4)

1. **Triggers fire on crossing, not exact equality** (a jump from 6 to 4 still notifies). A patient who is already within the threshold when added gets only the creation SMS. If both thresholds are crossed at once, only "you're next" is sent.
2. **Consultations under 1 minute (or over 3 hours) are ignored** for the ETA. Found in testing: quick double taps made the median ~0.1 min and the page said "any moment" with 3 people ahead.
3. **ETA range** = [floor5(ETA), ceil5(1.3 × ETA)], at least 10 minutes wide; under 5 minutes → "যেকোনো সময় ডাক পড়তে পারে". When the doctor is on a break the estimate continues as if running (the break banner is shown).
4. **Templates are fixed in code** (no template editor in the MVP), so the segment count is shown where a message is composed: the broadcast dialog. Each template is ≤ 2 Unicode segments with a typical doctor name and a ~30-character domain (unit-tested). A shorter production domain may bring some down to 1.
5. **Delay broadcast is not an automatic SMS**: it can be sent more than once and doesn't count toward the 3-per-token limit. Recipients are WAITING patients with a phone (not the one inside, not skipped/no-show).
6. **SMS provider is chosen by `SMS_PROVIDER`** (only `console` exists). A real Bangladeshi gateway plugs in by implementing `SmsProvider.send` (return `retryable: false` for permanent errors such as an invalid number).

## Phase 5 — what exists

- Daily reports (`src/lib/reports.ts`, `src/components/daily-report.tsx`):
  - **Clinic admin:** `/admin/reports` (new "রিপোর্ট" tab), showing every sitting in the organization for a chosen date.
  - **Doctor:** `/console/reports`, showing their own sittings only (new "কনসোল · রিপোর্ট" tabs on the doctor's console).
  - **Per sitting:**
    - patients served out of booked;
    - average wait;
    - average consultation time;
    - doctor's late-arrival minutes;
    - no-shows;
    - number of out-of-order calls.
  - **Day totals:** shown when there is more than one sitting, weighted by patient.
  - **Out-of-order list:** highlighted. Each entry shows the serial, patient, reason, note, who was jumped, the time, the doctor and who made the call.
- Super admin SMS usage: `/super/sms` (new tab next to "প্রতিষ্ঠান"). For a chosen month (Dhaka time), every organization is listed with:
  - billable segments;
  - sent SMS;
  - failed;
  - pending;

  plus a totals row.
- `src/instrumentation.ts` → `src/lib/bootstrap.ts`. On server start it:
  - creates the first super admin from `SEED_SUPERADMIN_PHONE` / `SEED_SUPERADMIN_PASSWORD`, only if none exists;
  - starts the SMS sweeper, so SMS queued before a restart get sent.
- `Dockerfile` (multi-stage, `node:22-bookworm-slim`), `docker-entrypoint.sh` and `.dockerignore`:
  - The runtime is the Next standalone server plus a small separate Prisma CLI install used for `migrate deploy` on start.
  - Migrations use `DIRECT_DATABASE_URL` when set.
- `README.md`: roles and pages, environment variables, FlyNode deploy steps, `docker build`/`docker run`, local development, checks.

### Verified
- tsc clean, ESLint clean.
- Vitest 121/121: 80 unit (7 new for reports) and 41 integration (3 new). The new integration tests cover:
  - report numbers and the out-of-order row with reason, note, jumped serials and actor;
  - a doctor-scoped report;
  - cross-tenant isolation;
  - SMS usage per org and month.
- E2E 5/5. The out-of-order test now also checks the call in `/admin/reports`.
- Container steps simulated without Docker:
  1. Ran the migrator stage (a separate `prisma@7.10.1` + `dotenv` install and `migrate deploy`) against a fresh database: both migrations applied.
  2. Ran the standalone server with only explicit env vars (no `.env`). The super admin was created on start, login worked, `/super/sms` returned 200, and static CSS was served.
  3. Dropped the scratch database afterwards.
- 360px in the browser:
  - Admin report and doctor report: no horizontal scroll, correct tab highlighted, the doctor sees only their own sitting.
  - SMS usage page.
  - Found and fixed: an early "arrival" from a test tap showed as "৯৩১ মিনিট আগে". It now shows "সময়মতো" (see decision 3).
  - The SMS page was checked with a temporary super admin in the dev DB, which was removed afterwards.
- **Not verified:** `docker build` / `docker run` of the actual image, because this machine has no Docker. The first FlyNode build is the real test.

## Decisions (Phase 5)

1. **Average wait** = from the scheduled start (or from when the serial was added, if that was later, e.g. a walk-in) until the patient was called. Only patients whose consultation finished count. Serials booked by phone in the morning don't count the hours before the sitting.
   - A re-queued patient's wait runs to their last call.
   - Called before the scheduled start → 0.
2. **Average consultation** uses the same rule as the ETA: from "entered" (or the call) to "done", ignoring under 1 minute and over 3 hours.
3. **Late arrival** = when the doctor arrived (first "next" or "doctor arrived" tap) minus the scheduled start.
   - Arriving early shows as "সময়মতো" and counts as 0 in the day average.
   - "আসেননি" if they never arrived.
   - Cancelled sittings are left out of the report.
4. **Reports are one day at a time** (date picker, today by default). No date ranges, charts or export: the brief asks for daily reports.
5. **Doctors' reports** live under `/console/reports`, since the doctor's home is the console. Assistants have no reports (PLAN §9).
6. **Billing counts segments of SENT messages** for the month in Dhaka time; failed and pending are shown separately and not billed. Every organization is listed, including those with 0.
7. **First super admin on production** is created by the server at start from env vars, so the production image needs neither the seed (which adds demo data) nor `tsx`. If a super admin already exists, the variables do nothing.
8. **Migrations run on every container start** (`prisma migrate deploy`, which only applies new migrations). The Prisma CLI is installed in its own folder in the image, because the standalone output doesn't include it.

## Deployment (2026-11-10)

- **Code:** GitHub `https://github.com/mdarkhan/liveserial` (public, branch `main`), remote `origin`.
- **App:** FlyNode app `liveserial`, built from the Dockerfile, port 3000, with a FlyNode PostgreSQL database (`DATABASE_URL` set by FlyNode).
  - Address: https://nt2dfm9rvn96knb7lgaurxm6.flynode.io (FlyNode default; Q8 custom domain still open).
- **Settings:** set by the owner through FlyNode's secure link: `BETTER_AUTH_SECRET`, `APP_BASE_URL`, `SEED_SUPERADMIN_PHONE`, `SEED_SUPERADMIN_PASSWORD`. Also `SMS_PROVIDER=console`.
- **Q2 answered:** FlyNode's database is a direct connection (no pooler), so `DIRECT_DATABASE_URL` isn't needed.
- **Verified live:**
  - The real Docker image built on FlyNode and both migrations applied on first start.
  - "Created super admin" was logged on start.
  - `/login` 200, `/admin` redirects to login, unknown patient link 404 page, static CSS 200.
  - Not verified by me: signing in as the super admin. The owner holds the password.
- **SMS:** only printed to the FlyNode runtime log until a Bangladeshi gateway is added.
- **Custom domain:** when added, change `APP_BASE_URL` to match.

## Phase 6 — optional UX features (owner request, 2026-11-10)

The owner asked for nine improvements, each switched on or off by the super admin per organization, with per-doctor overrides.

- **Switches:** `/super/orgs/[id]` (organization name or "ফিচার" in `/super`).
  - **Organization:** a checkbox per feature, plus "সব চালু" / "সব বন্ধ".
  - **Doctor:** per feature, "প্রতিষ্ঠানের মতো" / "চালু" / "বন্ধ".
  - **Storage:** JSON on `Organization.features` and `Doctor.features`. The rules are in `src/lib/features.ts`:
    - everything is off unless switched on;
    - a doctor override beats the organization setting;
    - "install on home screen" is organization-only.
  - **Delivery:** the effective flags travel inside each live view (patient, TV, console), so a change reaches open pages within a minute (the server's refresh) or on reload.
- **Patient page (`/t/…`):**
  - `PATIENT_PROGRESS`:
    - a bar showing patients seen vs. people ahead;
    - at ≤ 3 ahead, the page turns amber with "প্রস্তুত থাকুন";
    - at ≤ 1 ahead, it turns green.
  - `PATIENT_ALERT`: a "সতর্কতা চালু করুন" button.
    - While the page is open, it beeps and vibrates once when 2 people are left ahead, and again (longer) when the patient is called.
    - Web Audio, so there are no files to download.
  - `PATIENT_UPDATED_AGO`: shows "সর্বশেষ আপডেট: … সেকেন্ড আগে", and a warning when nothing has arrived for 60 s.
- **Waiting-room TV (`/display/…`):**
  - `DISPLAY_CHIME`: when a new serial is called, the number pops in and the panel flashes. With sound on, a "ding-dong" plays.
  - `DISPLAY_ANNOUNCE`: "সিরিয়াল ১২, ভেতরে আসুন".
    - Uses recorded files if present in `public/audio/bn/` (`serial.mp3`, `1.mp3`…`999.mp3`, `enter.mp3`).
    - Otherwise uses the device's Bangla voice, if it has one.
    - Otherwise nothing is announced (the chime still plays).
  - `DISPLAY_CONTROLS`: "বড় হরফ" (remembered per TV) and "ফুলস্ক্রিন" buttons.
  - **Sound needs one tap:** browsers require a tap before playing sound, so the TV shows a pulsing "শব্দ চালু করুন" button.
- **Assistant console:**
  - `CONSOLE_UNDO`: after these actions, a toast offers "পূর্বাবস্থায় ফেরান" for 5 seconds:
    - next / call;
    - entered / done;
    - skip / no-show;
    - cancel.
    - Server side: `undoAction` in `queue-service.ts`.
  - `CONSOLE_LOOKUP`: the phone field comes first. Once it holds a full number, the last name used with that phone in this organization fills in (`GET /api/sessions/[id]/lookup`).
  - `CONSOLE_PWA`:
    - `/app.webmanifest`, PNG icons in `public/icons/`, and iOS home-screen tags.
    - These are added only to console pages of organizations with the switch on.
    - A "হোম স্ক্রিনে যোগ করুন" bar on `/console`, or the Safari steps on iPhone.
- **Migrations** (new, not edits):
  - `20261110150000_features_and_undo`: feature JSON columns and the `UNDO` queue action.
  - `20261110150100_token_phone_index`: lookup index.
- **Dockerfile** now copies `public/` (icons, optional audio).
- **Demo seed:** turns every feature on for the demo clinic (new databases only).

### Verified
- tsc clean, ESLint clean.
- Vitest 140/140 (19 new). They cover:
  - flag rules and the form parsing;
  - each view carries only its own flags, and they are off by default;
  - undo:
    - "next", including going back to "not started";
    - skip, no-show and done;
    - refused after any later change, when repeated, for another user, after the window, for a non-undoable action, and across tenants;
    - idempotent by its own request id;
    - an undone out-of-order call leaves the daily report.
- E2E 5/5 (production build).
- Click-through in the browser, dev DB, temporary super admin removed afterwards:
  - **Super admin at 360px:**
    - "সব চালু" saved all nine;
    - a doctor override ("বন্ধ" for the progress bar) hid the bar on that doctor's patient page only;
    - setting it back to inherit showed it again.
    - Fixed: the organization list squeezed the name column at 360px once the "ফিচার" link was added; the buttons now wrap to their own row.
  - **Patient page at 360px:** amber tint, "প্রস্তুত থাকুন", and the bar "দেখা শেষ ৭ জন · আপনার আগে ৩ জন". After switching the alert on, an assistant's "next" (3 → 2 ahead) fired the vibration pattern.
  - **Console at 360px:**
    - "next" showed the toast "হয়েছে: পরের রোগী ডাকুন · সিরিয়াল ১০";
    - "পূর্বাবস্থায় ফেরান" brought back serial ৯ with "ফেরানো হয়েছে";
    - typing a known phone filled "আনোয়ার হোসেন" with "আগের রোগী — নাম বসানো হয়েছে";
    - the manifest and Apple tags were present, and a simulated install event showed the install bar.
  - **TV:**
    - a new call popped the number and flashed the panel;
    - it looked for the recorded files (none yet) and found no Bangla voice on this PC, so only the chime would play here;
    - "বড় হরফ" was remembered across reload;
    - fixed: big mode overflowed 1280×720 by 36px; now it fits;
    - no horizontal scroll at 360px.
- **Not verified:**
  - Actually hearing the chime or alert, because the test browser had no tap/sound.
  - Installing on a real phone.
  - Announcing with a real Bangla voice or recorded files.

## Decisions (Phase 6)

1. **Off by default, everywhere.** Existing organizations see no change until the super admin switches features on. The demo seed switches all of them on.
2. **Doctor override = three states** (same as organization / on / off), stored only when different. "Install on home screen" is organization-only, because the console isn't per doctor.
3. **Undo is the reverse of exactly one action by the same user:**
   - It is refused if anything else happened in that session afterwards, so it never overwrites another person's change.
   - The console offers it for 5 s; the server accepts it for 30 s (slow networks).
   - Each reversal is logged as an `UNDO` event (the original events stay; the log is append-only).
   - An undone out-of-order call no longer counts in the report.
   - SMS already queued by the undone action (e.g. "you're next") are not recalled.
   - Not offered for: adding patients (use cancel), doctor status, delay, broadcast.
4. **Returning-patient lookup** searches only this organization's serials (newest first, cancelled ignored). It never overwrites a name the assistant already typed; it offers "এই নাম দিন" instead.
5. **Patient alert:** sound needs a tap (browser rule), so it is an explicit button, and it lasts while the page is open. "Ready" at ≤ 3 ahead; the sound plays at ≤ 2 and when called.
6. **Announcements:** recorded audio is preferred, because Bangla text-to-speech is missing on many TVs. Until the clinic adds recordings, devices with a Bangla voice speak; others only chime.
7. **Install on home screen** is a web app manifest only, with no service worker or offline cache (not a native app; BRIEF scope).

## Phase 7 — break timer, "not coming", SMS cost and limit (owner request, 2026-11-10)

Three new switches go on the super admin's feature page, and there is a monthly SMS limit per organization.

- **Timed doctor break** (`DOCTOR_BREAK_TIMER`; doctor-level override possible):
  - "বিরতি" in the console opens a sheet: kind ("নামাজ" / "বিরতি") and length (৫–৬০ minutes), or "সময় ছাড়া বিরতি".
  - Stored as `Session.breakKind` + `breakEndsAt`; cleared on resume or end.
  - The patient page and TV show "ডাক্তার নামাজে আছেন — আনুমানিক রাত ১১:৫৮-এ ফিরবেন (আর ১৪ মিনিট)". When the time has passed: "যেকোনো সময় ফিরবেন".
  - The console shows the same line, in red when overdue.
  - The ETA adds the remaining break minutes and says so.
  - The server refuses a timed break where the switch is off.
- **"আমি আসছি না"** (`PATIENT_NOT_COMING`; doctor-level):
  - On the patient link, a waiting or skipped patient confirms once. The serial then becomes CANCELLED with `Token.cancelledByPatientAt`, and the people behind move up.
  - Server: `patientNotComing` in `queue-service.ts`, via `POST /api/live/t/[code]`.
    - Idempotent by request id.
    - Logged as `PATIENT_NOT_COMING`, with "রোগী নিজে" as the actor in the audit log.
  - The console instantly shows "সিরিয়াল ১৪: রোগী জানিয়েছেন আসছেন না…" (plus vibration). The patient appears under "লাইনে নেই" with an "আসছেন না" badge, and the assistant can put them back in line (after current / at end).
- **SMS cost preview** (`SMS_COST_PREVIEW`; organization-only):
  - **Console:** "৭৬ অক্ষর · ২ ভাগে যাবে" under the phone field when adding a patient, and under the delay-broadcast preview. Highlighted when more than 1 part.
  - **New admin page `/admin/sms` ("SMS খরচ" tab, only when on):**
    - this month's billable parts, sent and failed;
    - per doctor, each automatic message rendered with the real link length and a 3-digit serial, with characters and parts;
    - tips when a message needs 2+ parts.
- **SMS monthly limit** (super admin, `Organization.smsMonthlyLimit`, in billable parts; empty = no limit):
  - Set on `/super/orgs/[id]`, which also shows this month's use so far.
  - **Warnings:**
    - `/super` shows a "SMS সীমা সতর্কতা" box plus a badge per organization;
    - `/super/sms` shows "used / limit" per organization, a highlighted row, and the badge.
  - "সীমার কাছে" from 80%; "সীমা ছাড়িয়েছে" above 100%.
  - Warning only: sending is never blocked.
- **Migration** (new): `20261110170000_break_not_coming_sms_limit`.
- **Test fix:** the SMS-usage integration test now waits for the background outbox before changing message statuses. This race existed before and showed up once under load.

### Verified
- tsc clean, ESLint clean.
- Vitest 154/154, three runs in a row (14 new). They cover:
  - **Timed break:** stored and shown to patient and TV, ETA +break, resume clears, plain break, bad input refused, not shown after end.
  - **Not coming:**
    - waiting and skipped patients;
    - logged with no staff actor, and the others move up;
    - idempotent;
    - refused once called, for an unknown code, or after the session ends;
    - staff can re-queue it, but not a staff cancellation.
  - **SMS limit:** none / OK / near / over, against real sent parts.
  - **Views:** break only while on break; "not coming" listed with the away patients.
- E2E 5/5 (production build).
- Click-through at 360px (dev DB; temporary super admin and the test limit removed afterwards):
  - **Super admin:**
    - all 12 switches turned on;
    - a limit typed in Bangla digits ("৫") was saved;
    - `/super` showed the warning box "সেবা ক্লিনিক… ৪৬ / ৫ ভাগ — সীমা ছাড়িয়েছে";
    - `/super/sms` showed the red row.
  - **Clinic admin `/admin/sms`:** this month 46 parts / 23 SMS. Every automatic message for both doctors is 72–97 characters → 2 parts (see the note below).
  - **Console break:** the sheet opened; "নামাজ, ১৫" set it, and the console showed "নামাজ: ফিরবেন ~রাত ১১:৫৮ (আর ১৫ মিনিট)".
  - **Patient page during the break:** the banner showed the same time, the ETA was "৩০–৪৫ মিনিট" (3 × 6 + 15) with "বিরতির বাকি সময় হিসাবে যোগ করা আছে", and the countdown went 15 → 14. The TV showed the same.
  - **"আমি আসছি না":**
    - the confirmation appeared, then the patient saw "আপনি জানিয়েছেন আসছেন না";
    - the console showed the notice and an "আসছেন না" badge;
    - "এখনকার রোগীর পরে" put the patient back as next, and the patient page went back to "প্রস্তুত থাকুন · আপনার আগে ১ জন".
  - **SMS cost** lines in the add form and the broadcast sheet. Fixed: the add-form line had no label saying which SMS it was about.
  - No horizontal scroll on any page.
- **Not verified:** on a real phone, or with a real SMS gateway.

## Decisions (Phase 7)

1. **Break timer** is optional per doctor. Without it, "বিরতি" works as before (no time). Calling a patient during a break still works (the session becomes RUNNING). The timer then stops showing, and if that call is undone, the break with its timer comes back.
2. **"Not coming" is a cancellation by the patient**, not a new status. It reuses CANCELLED, plus a timestamp that marks it as the patient's, so reports, counts and the "one serving" rule are unchanged. Only staff can undo it, by re-queueing. The patient can't, so a mis-tap needs a word with the assistant; the confirmation step guards against that.
3. **Allowed from waiting or skipped only.** Once called, the assistant handles it ("উপস্থিত নেই").
4. **SMS limit counts billable parts of SENT messages** in the Dhaka month (same as billing). Near = 80%. It never blocks sending: a clinic's patients must still get their messages.
5. **SMS cost preview is organization-only:** the admin page is per clinic, and the console lines show for all its doctors.

**Finding for the owner:** with the current templates, every automatic SMS (serial, "রওনা দিন", "পরের জন", delay) is over 70 characters, so each costs 2 parts. The live address (`nt2dfm9rvn96knb7lgaurxm6.flynode.io`) is even longer than the dev one. A short custom domain (Q8) and/or shorter template wording would roughly halve SMS cost. Not changed: wording and domain are the owner's call.

## Known issues / notes

- Dev machine (Windows 10) has no Docker / psql; `npm run db:start` (embedded-postgres) is the local DB. Keep it running in its own terminal.
- npm `latest` for `prisma` is an 8.0 RC; we pin 7.10.1. TypeScript pinned to 5.9.3.
- The admin session page shows the last 30 audit events; the daily report (`/admin/reports`) lists every out-of-order call.
- Dev only: if the dev server hot-reloads while a form is submitted, the server action can be missed (seen once on login, during a hot reload). Believed to be dev-only; not yet checked against a production build.
- `npm run db:reset` is destructive (drops the dev DB); Prisma will ask for confirmation.
- Git remote `origin` = github.com/mdarkhan/liveserial. Ask before pushing.
- `next start` warns that it "does not work with output: standalone"; it works for the e2e run. The Docker image runs `node server.js` from the standalone output, as Next recommends.
- `next build` fails with EBUSY if the dev server (or a standalone server) is running from `.next`; stop it before `npm run test:e2e`.
- SSE connections are not rate-limited per IP yet (public links are unguessable: ~57.8-bit codes / UUIDs). Revisit before launch if needed.
- A `pg` deprecation warning ("client.query() when the client is already executing a query") appears in tests; it comes from inside `@prisma/adapter-pg`'s transaction handling, not our code. Harmless now; recheck when upgrading Prisma / pg 9.
- SMS links use `APP_BASE_URL`; set it to the real HTTPS domain in production (Q8 — a short domain saves SMS segments).
- Docker isn't installed on the dev machine; the image is built by FlyNode (first build succeeded 2026-11-10).
- **`.env.example` may need two lines added by the owner** (agent edits to env files are blocked):
  - `DIRECT_DATABASE_URL=` with a comment "only if DATABASE_URL goes through a pooler";
  - `SEED_SUPERADMIN_PHONE` / `SEED_SUPERADMIN_PASSWORD`, if they're missing.

  README lists every variable.
- Open question: Q8 (production domain). Q2 answered: direct connection.
- Recorded announcement audio (`public/audio/bn/serial.mp3`, `1.mp3`…, `enter.mp3`) has to come from the clinic/owner; until then TVs without a Bangla voice only chime.
