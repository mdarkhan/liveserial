# LiveSerial

Multi-tenant live queue + wait-time app for Bangladeshi doctor chambers.

Before doing anything, read:
1. `docs/BRIEF.md` — the owner's requirements and working rules (phases, stop for review, ask before stack changes / paid services / pushing / touching applied migrations).
2. `docs/PLAN.md` — agreed architecture and decisions.
3. `PROGRESS.md` — current phase, open issues. Keep it updated at the end of every phase.

Hard rules from the brief: all UI text in Bangla via `src/lib/i18n/bn.ts`; every tenant query scoped by `organizationId`; every queue mutation idempotent (client request ID) and logged to `QueueEvent`; store UTC, display Asia/Dhaka; nothing out of MVP scope.
