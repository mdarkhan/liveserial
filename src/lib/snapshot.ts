import { prisma } from "@/lib/db";
import { AWAY, byQueueOrder, nowServing, peopleAhead, waitingInOrder } from "@/lib/queue";
import type { SessionStatus, TokenStatus } from "@/generated/prisma/enums";

/**
 * Read models. A session's data is loaded ONCE per change (loadSessionData)
 * and then projected for each kind of viewer:
 *   console  → staff only: names, phones, full lists
 *   display  → public TV: serial numbers only
 *   patient  → public link: that patient's own serial + queue position only
 * Projections are pure functions, so they're unit-tested without a DB.
 */

export async function loadSessionData(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      doctor: { select: { name: true } },
      chamber: { select: { name: true, leaveNowThreshold: true } },
      tokens: {
        select: {
          id: true,
          serial: true,
          queueOrder: true,
          status: true,
          patientName: true,
          patientPhone: true,
          isEmergency: true,
          publicCode: true,
        },
      },
    },
  });
}

export type SessionData = NonNullable<Awaited<ReturnType<typeof loadSessionData>>>;

type SessionInfo = {
  id: string;
  status: SessionStatus;
  doctorName: string;
  chamberName: string;
  scheduledStartAt: string;
  doctorArrivedAt: string | null;
  announcedDelayMinutes: number | null;
  queueVersion: number;
};

function sessionInfo(d: SessionData): SessionInfo {
  return {
    id: d.id,
    status: d.status,
    doctorName: d.doctor.name,
    chamberName: d.chamber.name,
    scheduledStartAt: d.scheduledStartAt.toISOString(),
    doctorArrivedAt: d.doctorArrivedAt?.toISOString() ?? null,
    announcedDelayMinutes: d.announcedDelayMinutes,
    queueVersion: d.queueVersion,
  };
}

// ───────────── console (staff) ─────────────

export type ConsoleToken = {
  id: string;
  serial: number;
  name: string;
  phone: string | null;
  status: TokenStatus;
  isEmergency: boolean;
};

export type ConsoleView = {
  session: SessionInfo;
  current: ConsoleToken | null;
  waiting: ConsoleToken[];
  away: ConsoleToken[];
  doneCount: number;
  cancelledCount: number;
  total: number;
  serverTime: string;
};

export function projectConsole(d: SessionData, now = new Date()): ConsoleView {
  const toView = (t: SessionData["tokens"][number]): ConsoleToken => ({
    id: t.id,
    serial: t.serial,
    name: t.patientName,
    phone: t.patientPhone,
    status: t.status,
    isEmergency: t.isEmergency,
  });
  const current = nowServing(d.tokens);
  return {
    session: sessionInfo(d),
    current: current ? toView(current) : null,
    waiting: waitingInOrder(d.tokens).map(toView),
    away: d.tokens
      .filter((t) => AWAY.includes(t.status))
      .sort(byQueueOrder)
      .map(toView),
    doneCount: d.tokens.filter((t) => t.status === "DONE").length,
    cancelledCount: d.tokens.filter((t) => t.status === "CANCELLED").length,
    total: d.tokens.length,
    serverTime: now.toISOString(),
  };
}

/** Console view for a staff member of `orgId` (null if not found / other tenant). */
export async function getConsoleView(orgId: string, sessionId: string): Promise<ConsoleView | null> {
  const d = await loadSessionData(sessionId);
  if (!d || d.organizationId !== orgId) return null;
  return projectConsole(d);
}

// ───────────── display (public TV) ─────────────

export type DisplayView = {
  v: number;
  status: SessionStatus;
  doctorName: string;
  chamberName: string;
  scheduledStartAt: string;
  nowServing: number | null;
  next: number[];
  serverTime: string;
};

export function projectDisplay(d: SessionData, now = new Date()): DisplayView {
  return {
    v: d.queueVersion,
    status: d.status,
    doctorName: d.doctor.name,
    chamberName: d.chamber.name,
    scheduledStartAt: d.scheduledStartAt.toISOString(),
    nowServing: nowServing(d.tokens)?.serial ?? null,
    next: waitingInOrder(d.tokens)
      .slice(0, 3)
      .map((t) => t.serial),
    serverTime: now.toISOString(),
  };
}

// ───────────── patient (public link) ─────────────

export type PatientView = {
  v: number;
  session: Omit<SessionInfo, "id" | "queueVersion">;
  nowServing: number | null;
  you: {
    serial: number;
    status: TokenStatus;
    /** Waiting ahead + the patient inside (1 = you're next). Null unless WAITING. */
    peopleAhead: number | null;
    leaveNow: boolean;
  };
  leaveNowThreshold: number;
  serverTime: string;
};

/** No names, no phones — only this patient's own serial and position. */
export function projectPatient(d: SessionData, publicCode: string, now = new Date()): PatientView | null {
  const me = d.tokens.find((t) => t.publicCode === publicCode);
  if (!me) return null;
  const { status, doctorName, chamberName, scheduledStartAt, doctorArrivedAt, announcedDelayMinutes } = sessionInfo(d);
  const session = { status, doctorName, chamberName, scheduledStartAt, doctorArrivedAt, announcedDelayMinutes };
  const open = d.status !== "ENDED" && d.status !== "CANCELLED";
  const ahead = me.status === "WAITING" && open ? peopleAhead(me, d.tokens) : null;
  return {
    v: d.queueVersion,
    session,
    nowServing: nowServing(d.tokens)?.serial ?? null,
    you: {
      serial: me.serial,
      status: me.status,
      peopleAhead: ahead,
      leaveNow: ahead !== null && ahead <= d.chamber.leaveNowThreshold,
    },
    leaveNowThreshold: d.chamber.leaveNowThreshold,
    serverTime: now.toISOString(),
  };
}

/** Session id for a patient link, or null. */
export async function sessionIdForCode(publicCode: string): Promise<string | null> {
  if (!/^[2-9a-hj-km-np-zA-HJ-NP-Z]{8,16}$/.test(publicCode)) return null;
  const t = await prisma.token.findUnique({ where: { publicCode }, select: { sessionId: true } });
  return t?.sessionId ?? null;
}
