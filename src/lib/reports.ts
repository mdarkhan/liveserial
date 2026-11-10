import { prisma } from "./db";
import { dateOnly, dhakaWallTimeToUtc } from "./format";
import { consultMinutes } from "./snapshot";
import type { OutOfOrderReason, SessionStatus, SmsStatus, TokenStatus } from "@/generated/prisma/enums";

// ───────────── Pure helpers (unit-tested) ─────────────

export type ReportToken = {
  status: TokenStatus;
  createdAt: Date;
  calledAt: Date | null;
  consultStartedAt: Date | null;
  completedAt: Date | null;
};

/**
 * How long a served patient waited, in minutes: from the scheduled start (or
 * from when their serial was added, if later — a walk-in) until they were
 * called. Patients are told to come at the scheduled time, so a serial booked
 * by phone in the morning doesn't count the hours before the sitting.
 */
export function waitMinutes(tk: ReportToken, scheduledStartAt: Date): number | null {
  if (!tk.calledAt) return null;
  const from = Math.max(tk.createdAt.getTime(), scheduledStartAt.getTime());
  return Math.max(0, (tk.calledAt.getTime() - from) / 60_000);
}

/** Doctor's arrival vs the scheduled start, in whole minutes (negative = early). null = never arrived. */
export function lateMinutes(scheduledStartAt: Date, doctorArrivedAt: Date | null): number | null {
  if (!doctorArrivedAt) return null;
  return Math.round((doctorArrivedAt.getTime() - scheduledStartAt.getTime()) / 60_000);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export type SessionSummary = {
  booked: number;
  served: number;
  noShow: number;
  /** Rounded minutes; null when there is nothing to average. */
  avgWait: number | null;
  avgConsult: number | null;
  late: number | null;
  /** Raw samples, so day totals are weighted by patient, not by session. */
  waits: number[];
  consults: number[];
};

export function summarizeSession(
  s: { scheduledStartAt: Date; doctorArrivedAt: Date | null },
  tokens: ReportToken[],
): SessionSummary {
  const served = tokens.filter((t) => t.status === "DONE");
  const waits = served.map((t) => waitMinutes(t, s.scheduledStartAt)).filter((m): m is number => m !== null);
  const consults = served.map(consultMinutes).filter((m): m is number => m !== null);
  return {
    booked: tokens.filter((t) => t.status !== "CANCELLED").length,
    served: served.length,
    noShow: tokens.filter((t) => t.status === "NO_SHOW").length,
    avgWait: roundOrNull(mean(waits)),
    avgConsult: roundOrNull(mean(consults)),
    late: lateMinutes(s.scheduledStartAt, s.doctorArrivedAt),
    waits,
    consults,
  };
}

export function summarizeDay(sessions: SessionSummary[]) {
  const lates = sessions.map((s) => s.late).filter((m): m is number => m !== null);
  return {
    booked: sessions.reduce((a, s) => a + s.booked, 0),
    served: sessions.reduce((a, s) => a + s.served, 0),
    noShow: sessions.reduce((a, s) => a + s.noShow, 0),
    avgWait: roundOrNull(mean(sessions.flatMap((s) => s.waits))),
    avgConsult: roundOrNull(mean(sessions.flatMap((s) => s.consults))),
    /** Average lateness of the sittings the doctor came to; early counts as 0. */
    avgLate: roundOrNull(mean(lates.map((m) => Math.max(0, m)))),
  };
}

function roundOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}

/** "YYYY-MM" (Dhaka) → [start, end) as UTC instants. */
export function dhakaMonthRange(ym: string): { from: Date; to: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw new Error(`Bad month: ${ym}`);
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: dhakaWallTimeToUtc(`${ym}-01`, "00:00"), to: dhakaWallTimeToUtc(`${next}-01`, "00:00") };
}

// ───────────── Queries ─────────────

export type OutOfOrderRow = {
  id: string;
  at: Date;
  doctorName: string;
  serial: number | null;
  patientName: string | null;
  actorName: string | null;
  reason: OutOfOrderReason | null;
  note: string | null;
  jumpedSerials: number[];
};

export type DailyReport = {
  sessions: Array<{
    id: string;
    doctorName: string;
    chamberName: string;
    scheduledStartAt: Date;
    status: SessionStatus;
    summary: SessionSummary;
    outOfOrder: number;
  }>;
  totals: ReturnType<typeof summarizeDay>;
  outOfOrder: OutOfOrderRow[];
};

/**
 * One Dhaka calendar day for an organization. `doctorId` limits it to one
 * doctor (a doctor's own report). Cancelled sittings are left out.
 */
export async function getDailyReport(orgId: string, date: string, doctorId?: string): Promise<DailyReport> {
  const sessions = await prisma.session.findMany({
    where: {
      organizationId: orgId,
      date: dateOnly(date),
      status: { not: "CANCELLED" },
      ...(doctorId ? { doctorId } : {}),
    },
    orderBy: { scheduledStartAt: "asc" },
    include: {
      doctor: { select: { name: true } },
      chamber: { select: { name: true } },
      tokens: {
        select: { status: true, createdAt: true, calledAt: true, consultStartedAt: true, completedAt: true },
      },
    },
  });
  const sessionIds = sessions.map((s) => s.id);
  // Out-of-order calls that were undone in the console don't count.
  const undos = await prisma.queueEvent.findMany({
    where: { organizationId: orgId, action: "UNDO", sessionId: { in: sessionIds } },
    select: { meta: true },
  });
  const undone = [...new Set(undos.map((u) => (u.meta as { undoOf?: string } | null)?.undoOf).filter((x): x is string => !!x))];
  const events = await prisma.queueEvent.findMany({
    where: {
      organizationId: orgId,
      isOutOfOrder: true,
      sessionId: { in: sessionIds },
      ...(undone.length ? { OR: [{ clientRequestId: null }, { clientRequestId: { notIn: undone } }] } : {}),
    },
    orderBy: { id: "asc" },
    include: {
      token: { select: { serial: true, patientName: true } },
      actor: { select: { name: true } },
    },
  });

  const doctorOf = new Map(sessions.map((s) => [s.id, s.doctor.name]));
  const rows = sessions.map((s) => ({
    id: s.id,
    doctorName: s.doctor.name,
    chamberName: s.chamber.name,
    scheduledStartAt: s.scheduledStartAt,
    status: s.status,
    summary: summarizeSession(s, s.tokens),
    outOfOrder: events.filter((e) => e.sessionId === s.id).length,
  }));

  return {
    sessions: rows,
    totals: summarizeDay(rows.map((r) => r.summary)),
    outOfOrder: events.map((e) => ({
      id: String(e.id),
      at: e.createdAt,
      doctorName: doctorOf.get(e.sessionId) ?? "",
      serial: e.token?.serial ?? null,
      patientName: e.token?.patientName ?? null,
      actorName: e.actor?.name ?? null,
      reason: e.reason,
      note: e.note,
      jumpedSerials: ((e.meta ?? {}) as { jumpedSerials?: number[] }).jumpedSerials ?? [],
    })),
  };
}

export type SmsUsageRow = {
  orgId: string;
  name: string;
  slug: string;
  sent: number;
  /** Billable unit: what the gateway charges for. */
  sentSegments: number;
  failed: number;
  pending: number;
};

/** SMS per organization for one Dhaka month (super admin, for billing). All organizations are listed. */
export async function getSmsUsage(ym: string): Promise<SmsUsageRow[]> {
  const { from, to } = dhakaMonthRange(ym);
  const [orgs, groups] = await Promise.all([
    prisma.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } }),
    prisma.smsMessage.groupBy({
      by: ["organizationId", "status"],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { segments: true },
    }),
  ]);
  const get = (orgId: string, statuses: SmsStatus[]) =>
    groups.filter((g) => g.organizationId === orgId && statuses.includes(g.status));
  const count = (gs: typeof groups) => gs.reduce((a, g) => a + g._count._all, 0);

  return orgs
    .map((o) => {
      const sent = get(o.id, ["SENT"]);
      return {
        orgId: o.id,
        name: o.name,
        slug: o.slug,
        sent: count(sent),
        sentSegments: sent.reduce((a, g) => a + (g._sum.segments ?? 0), 0),
        failed: count(get(o.id, ["FAILED"])),
        pending: count(get(o.id, ["QUEUED", "SENDING"])),
      };
    })
    .sort((a, b) => b.sentSegments - a.sentSegments || a.name.localeCompare(b.name));
}
