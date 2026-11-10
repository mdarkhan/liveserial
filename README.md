# LiveSerial (লাইভ সিরিয়াল)

Live queue and wait-time estimate for doctor chambers in Bangladesh. Patients open the link from their SMS and see the serial now being served, how many people are ahead of them, and an approximate wait. Assistants run the queue from a phone, a waiting-room TV shows the line, and clinic admins get daily reports.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Prisma 7 + PostgreSQL, Better Auth, Vitest, Playwright.
- **One container:** a Next.js standalone server. It applies database migrations when it starts and is configured only through environment variables.
- **More detail:** the requirements are in [docs/BRIEF.md](docs/BRIEF.md), the architecture in [docs/PLAN.md](docs/PLAN.md), and status and decisions in [PROGRESS.md](PROGRESS.md).

## Roles and pages

| Role | Home | Can do |
|---|---|---|
| Super admin | `/super` | Organizations, optional features per organization and doctor (`/super/orgs/<id>`), SMS usage per organization for billing (`/super/sms`) |
| Clinic admin | `/admin` | Sessions, daily reports (`/admin/reports`), doctors, chambers, schedules, users, and the console |
| Assistant | `/console` | Runs the queue for any sitting in their organization |
| Doctor | `/console` | Sees their own queue (read-only) and their own daily report (`/console/reports`) |
| Patient | `/t/<code>` | Live position and wait estimate (the link comes by SMS, no login) |
| Waiting-room TV | `/display/<sessionId>` | Now serving and the next patients (no login) |

## Optional features

Nine extras are switched on by the super admin per organization (`/super/orgs/<id>`), with per-doctor overrides. All of them are off until switched on:

- **Patient page:** progress bar and "get ready", sound and vibration alert, "updated … seconds ago".
- **Waiting-room TV:** chime and pop animation, Bangla announcement, big-number and fullscreen buttons.
- **Console:** 5-second undo, returning-patient name from the phone number, install on home screen.

**Announcement audio (optional):** put recordings in `public/audio/bn/`:

- `serial.mp3` ("সিরিয়াল");
- `1.mp3`, `2.mp3`, … (the numbers);
- `enter.mp3` ("ভেতরে আসুন").

Without them, TVs use the device's Bangla voice if it has one, otherwise only the chime. A TV needs one tap on "শব্দ চালু করুন" after loading, because browsers require it before playing sound.

## Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `DIRECT_DATABASE_URL` | if `DATABASE_URL` goes through a pooler | A direct (non-pooled) connection. It's used for live updates (LISTEN/NOTIFY) and migrations. Leave it unset when `DATABASE_URL` is already direct. |
| `BETTER_AUTH_SECRET` | yes | A long random string (32+ characters). Generate one with `openssl rand -base64 32`. Changing it signs everyone out. |
| `APP_BASE_URL` | yes | The public HTTPS address, e.g. `https://serial.example.com`. Used for sign-in cookies and in the SMS links. A short domain keeps SMS cheaper. |
| `SMS_PROVIDER` | no | `console` (default) prints SMS to the server log. Real gateways plug in at `src/lib/sms.ts`. |
| `SEED_SUPERADMIN_PHONE` | first start | The phone number of the first super admin, e.g. `01711000000`. |
| `SEED_SUPERADMIN_PASSWORD` | first start | That user's password (8+ characters). The server creates this user on start **only if no super admin exists yet**, so the two variables can be removed afterwards. |
| `PORT` | no | Port inside the container. Defaults to `3000`. |

Times are stored in UTC and shown in Asia/Dhaka. The server doesn't depend on the host's time zone.

## Deploy (FlyNode, from GitHub)

1. **Push this repository to GitHub.** FlyNode builds from the `Dockerfile` in the repository root.
2. **Create the app** on FlyNode from that repository. The container listens on port **3000**.
3. **Add a PostgreSQL database** to the app and set `DATABASE_URL` to its connection string.
   - If the connection goes through a pooler such as PgBouncer in transaction mode, also set `DIRECT_DATABASE_URL` to the direct connection. Without it, LISTEN doesn't work through the pooler, so live screens only catch up on the server's once-a-minute refresh instead of within a second.
4. **Set the remaining variables** from the table above: `BETTER_AUTH_SECRET`, `APP_BASE_URL`, `SEED_SUPERADMIN_PHONE` and `SEED_SUPERADMIN_PASSWORD`. Enter secrets in FlyNode's environment settings, never in the repository.
5. **Deploy.** On start, the container:
   1. runs `prisma migrate deploy`, applying any new migrations (existing data is untouched);
   2. starts the server;
   3. creates the first super admin if there is none;
   4. starts the SMS retry sweeper.
6. **Add the domain**, make sure it's served over HTTPS, and confirm `APP_BASE_URL` matches it exactly.
7. **Sign in** at `https://<domain>/login` with the super admin phone and password. Then:
   1. create an organization with its first clinic admin (`/super`);
   2. as that clinic admin, add doctors, chambers, schedules and assistants.

**Updating:** push to GitHub and redeploy. Migrations run automatically on the next start.

**Health check:** `GET /login` returns 200 when the server is up.

### Build and run the image yourself

```bash
docker build -t liveserial .
```

```bash
docker run --rm -p 3000:3000 -e DATABASE_URL=postgresql://user:pass@host:5432/liveserial -e BETTER_AUTH_SECRET=change-me-to-a-long-random-string -e APP_BASE_URL=http://localhost:3000 -e SEED_SUPERADMIN_PHONE=01711000000 -e SEED_SUPERADMIN_PASSWORD=change-me liveserial
```

## Local development

Requirements: Node 22+. No Docker or local PostgreSQL is needed, because the dev database runs from the `embedded-postgres` package.

1. Create `.env` from `.env.example`. Point `DATABASE_URL` at `postgresql://postgres:postgres@localhost:5433/liveserial`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the dev database on port 5433 in its own terminal and leave it running:
   ```bash
   npm run db:start
   ```
4. Apply the migrations:
   ```bash
   npm run db:deploy
   ```
5. Load the demo clinic: 2 doctors, users for each role, and 25 patients today. The password for every demo user is `demo1234`.
   ```bash
   npm run db:seed
   ```
6. Start the app:
   ```bash
   npm run dev
   ```

Demo logins (phone / `demo1234`): clinic admin `01711000001`, assistant `01711000002`, doctor `01711000003`.

### Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:e2e
```

- `npm test` runs the unit and integration tests. Integration tests use a separate `liveserial_test` database on the dev server.
- `npm run test:e2e` does a production build and runs the Playwright tests at 360px in Microsoft Edge.

## Project layout

```
src/app/            pages and API routes (admin, super, console, t, display, api)
src/lib/            queue engine, live updates, wait-time estimate, SMS, reports, auth
src/lib/i18n/bn.ts  every user-facing string (Bangla)
prisma/             schema, migrations, demo seed
tests/              unit, integration (real Postgres), e2e (Playwright)
Dockerfile          production image; docker-entrypoint.sh runs migrations then the server
```
