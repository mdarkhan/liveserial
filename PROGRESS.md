# PROGRESS

Read [docs/BRIEF.md](docs/BRIEF.md) (requirements) and [docs/PLAN.md](docs/PLAN.md) (architecture + decisions) first.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Plan | **Done, awaiting owner review** (2026-11-10) | Schema in `prisma/schema.prisma` validated with Prisma 7.10.1. 8 open questions in PLAN.md §12. |
| 1 — Foundation | Not started | Blocked on OK for Phase 0 + answer to open question 1 (local Postgres). |
| 2 — Queue engine | Not started | |
| 3 — Live view | Not started | |
| 4 — ETA and SMS | Not started | |
| 5 — Admin and deploy | Not started | |

## Decisions

See PLAN.md §11. Changes to those decisions are recorded here with a date.

## Known issues / environment notes

- Dev machine (Windows 10) has Node 22.17, npm 10.9, pnpm 11, git 2.52. **No Docker, no psql** — local Postgres approach pending (PLAN.md §12 Q1).
- npm `latest` for `prisma` is an 8.0 RC; we pin 7.10.1. TypeScript pinned to 5.9.3.
- No git remote configured. Don't push without asking.
