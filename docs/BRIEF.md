# LiveSerial — Project Brief

Working name: LiveSerial (লাইভ সিরিয়াল). Rename freely later.

*(Saved verbatim from the owner's brief on 2026-11-10 so every session can read it.)*

## Your role

You are the lead engineer building LiveSerial: a multi-tenant web app that shows patients at Bangladeshi private doctor chambers their live queue position and an honest wait-time estimate. You build it in phases and stop for my review at the end of each phase.

## Why this exists (read first — it explains most of the decisions below)

At private chambers in Bangladesh, patients get a serial number and a rough time, but doctors often arrive late, move between chambers, or run over. Patients arrive early "to be safe" and wait 2–3 hours, often elderly and unwell. Some assistants also sell "serial jumping" for cash.

LiveSerial fixes this simply:

- The assistant taps one big button ("পরের রোগী ডাকুন") each time a patient goes in.
- Every patient gets an SMS with a link. The link shows the serial now being served, how many people are ahead, and an estimated wait — live. No app install, no login.
- The doctor / clinic owner gets transparency: an audit log of every call, including any patient called out of order and the reason. This is our main selling point to doctors, so treat the audit trail as a core feature, not an afterthought.

Who uses it, and what that means for the build:

- Assistants: low tech literacy, cheap Android phones, often slow 3G or patchy connections, one hand busy. → One-thumb UI, huge buttons, Bangla, clear "saved / syncing / failed" state, and every action must be safe to retry.
- Patients: many are elderly, on cheap phones, may not read English. → Fast-loading page (keep client JS small), Bangla, large numerals, nothing to log into.
- Clinic admins / doctors: check reports on a laptop or phone.

## Success criteria for the MVP

- An assistant can run a full chamber session (25–60 patients) from a phone without training beyond a 2-minute demo.
- A patient opening their link sees the correct "now serving" number within ~5 seconds of the assistant tapping.
- Two assistants tapping "next" at the same moment never call two patients or skip one.
- Every queue change is recorded (who, what, when, from → to) and visible in reports.
- Wait estimates are shown as honest ranges and never pretend to be precise.
- The app runs in a single Docker container with PostgreSQL, configured only via environment variables.

## Tech stack (decided — ask before swapping any of these)

- Next.js (App Router) + TypeScript (strict)
- PostgreSQL + Prisma
- Tailwind CSS
- Live updates: Server-Sent Events from a route handler. Use Postgres `LISTEN/NOTIFY` to fan events out, so it keeps working if we later run more than one instance. The client falls back to polling every 15 seconds if SSE fails. No third-party realtime service.
- Auth: pick one maintained library (e.g. Auth.js or Better Auth) and justify it in one line in Phase 0. Users log in with phone number + password.
- SMS: a `SmsProvider` interface with a `ConsoleSmsProvider` for development. A real Bangladeshi SMS gateway will be added later, when credentials exist.
- Tests: Vitest for logic (queue engine, ETA); Playwright for 2–3 critical flows.
- Deploy: a Dockerfile. Deployed from GitHub to the owner's hosting platform (FlyNode), which provides the PostgreSQL database.
- Time: store UTC, display in Asia/Dhaka everywhere.

## Domain model (starting point — refine in Phase 0)

- Organization — a clinic, hospital, or a solo doctor's practice (multi-tenant boundary; every query must be scoped to it).
- User — role: `SUPER_ADMIN`, `ORG_ADMIN`, `DOCTOR`, `ASSISTANT`.
- Doctor, Chamber (a room/location within an organization).
- ScheduleTemplate — doctor + chamber + weekday + scheduled start time.
- Session — one doctor's sitting on one date. Status: `NOT_STARTED`, `DOCTOR_ARRIVED`, `RUNNING`, `ON_BREAK`, `ENDED`, `CANCELLED`.
- Token — one patient's serial in a session: serial number, patient name, phone, status (`WAITING`, `CALLED`, `IN_CONSULT`, `DONE`, `SKIPPED`, `NO_SHOW`), emergency flag, and a random `publicCode` (8+ chars, unguessable) for the patient link.
- QueueEvent — append-only log: actor, action, timestamp, token, from-status → to-status, reason.
- SmsMessage — log of every SMS: token, template, segments, provider status. Used for billing per organization.

## Queue rules

- Serial numbers are unique within a session. Assistants already take bookings by phone, so support both quick add (name + phone, two fields) and bulk add (paste a list).
- "Next" calls the lowest-numbered `WAITING` token by default.
- Calling out of order (late arrival, emergency, follow-up report check) is allowed, but the assistant must pick a reason from a short list. It is logged and highlighted in reports.
- A `NO_SHOW` patient who arrives late can be re-queued either "after the current patient" or "at the end".
- "Next" must be transactional (row lock or version column), so concurrent taps can't double-call or skip.
- Every mutating action carries a client request ID, so a retry on a flaky connection never applies twice.

## Wait-time estimate (keep it simple and honest)

- Minutes per consultation = median of the last 10 completed consultations in this session. If there are fewer than 3, use the doctor's median over their last 30 sessions. If that doesn't exist either, default to 6 minutes.
- If the doctor has arrived: ETA = people ahead × minutes per consultation.
- If the doctor hasn't arrived: start = the later of now, or scheduled start + the doctor's median arrival delay over the last 30 sessions. ETA = that start + people ahead × minutes per consultation.
- Display it as a range rounded to 5 minutes (e.g. "৩০–৪৫ মিনিট"), never a single exact number. If the doctor hasn't arrived, show "ডাক্তার এখনো আসেননি" prominently.
- Cover every branch with unit tests.

## Screens

1. **Assistant console** (mobile-first, the most important screen):
   - Session header with doctor-status buttons (arrived, break, ended, running late by N minutes).
   - A huge "পরের রোগী ডাকুন" button and a "now serving" card.
   - Waiting list with skip / no-show / re-queue / call-out-of-order.
   - Quick add and bulk add.
   - Delay broadcast (see Notifications).
2. **Patient page** `/t/[publicCode]`: doctor name, chamber, session status, now-serving serial (very large), your serial, people ahead, ETA range, "last updated" time, and a "এখন রওনা দিন" banner when people ahead ≤ the chamber's threshold.
   - Server-render the first view so it shows something even before JavaScript loads.
   - Show no other patients' names or any phone numbers.
3. **Waiting-room display** `/display/[sessionId]`: for a TV or tablet — huge now-serving number plus the next 3 serials.
4. **Org admin:** doctors, chambers, schedules, users, and reports. Daily reports cover: patients served, average wait, average consultation time, doctor's late-arrival minutes, and out-of-order calls with reasons.
5. **Super admin:** organizations list, create organization, SMS usage per organization (for billing).

## Notifications

- Send a Bangla SMS with the patient link at three points: when the token is created, when people ahead equals the chamber's "leave now" threshold (default 5, configurable per chamber), and when people ahead equals 1.
- Maximum 3 automatic SMS per token. Never send the same trigger twice.
- Delay broadcast: the assistant can send a message such as "ডাক্তার ৩০ মিনিট দেরিতে আসবেন" to all waiting patients. Before sending, a confirm dialog shows the recipient count and SMS segment count.
- Bangla SMS is Unicode (about 70 characters per segment), so keep templates short and show the segment count wherever templates are edited.

## Design

- Healthcare: trustworthy, calm, high-contrast (WCAG AA).
- White or very light gray background, teal primary (around #0F766E), clear green / amber / red status colors.
- Bangla font: Hind Siliguri or Noto Sans Bengali, loaded via `next/font`.
- Not an editorial look: no cream backgrounds, no serif display fonts, no terracotta.
- Minimum tap target 48px; the primary action button at least 64px tall.
- Test every screen at 360px width.
- If a `ui-ux-pro-max` skill (or similar UI skill) is available in this environment, read it before building any UI.

## Language

- All UI text in Bangla, kept in one dictionary file so English can be added later.
- Use Bangla digits on patient-facing pages and the display screen.

## Out of scope for the MVP — do not build

Online payment, patient self-booking, native mobile apps, WhatsApp API, AI/ML prediction, video consultation, prescriptions. Don't add these even if they seem helpful.

## How we work

- Phases. Stop after each phase. Report: what was built, how to run and test it, what is not done, and any decisions made. Commit at the end of each phase with a clear message.
  - **Phase 0 — Plan.** Propose the final Prisma schema, folder structure, auth library choice (one-line reason), how SSE + `LISTEN/NOTIFY` will work, and open questions. Only scaffolding, no app code. Wait for OK.
  - **Phase 1 — Foundation.** Scaffold, database, auth, CRUD for organization / doctor / chamber / session / token, and a seed script with demo data (1 org, 2 doctors, 1 session with 25 tokens).
  - **Phase 2 — Queue engine.** Assistant console, transactional queue actions (next / skip / no-show / re-queue / out-of-order with reason), QueueEvent logging, and tests.
  - **Phase 3 — Live view.** Patient page, SSE live updates with polling fallback, and the waiting-room display.
  - **Phase 4 — ETA and SMS.** ETA engine, SMS provider abstraction, notification triggers, and delay broadcast.
  - **Phase 5 — Admin and deploy.** Admin reports, super admin, Dockerfile, `.env.example`, and a README with deploy steps.
- Verify before saying done. Run typecheck, lint, and tests. For UI phases, run the app and click through the flow at 360px width. Report the actual results; if something fails or couldn't be tested, say so plainly.
- Ask first before: adding any paid service, changing the stack, deleting data or editing migrations that have already been applied, or pushing to a git remote.
- Ambiguity: choose the simplest reasonable reading, write it under "Decisions" in the phase report, and continue. Only stop to ask when a wrong guess would be expensive to undo.
- Keep it simple. No extra abstraction layers, no features beyond this file, prefer fewer files. Once an approach is chosen, commit to it; change course only if new information contradicts it.
- Keep `PROGRESS.md` up to date with phase status, decisions, and known issues, so a fresh session can pick up where the last one stopped.
