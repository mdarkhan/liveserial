import { prisma } from "@/lib/db";
import { computeEta, median } from "@/lib/eta";
import { resolveFeatures, type FeatureFlags } from "@/lib/features";
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
  const session = await loadSessionRow(sessionId);
  if (!session) return null;
  const stats = await getDoctorStats(session.doctorId, session.id);
  // Optional features for this sitting: the doctor's override, else the organization's.
  const features = resolveFeatures(session.organization.features, session.doctor.features);
  return { ...session, stats, features };
}

async function loadSessionRow(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      organization: { select: { features: true } },
      doctor: { select: { name: true, features: true } },
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
          calledAt: true,
          consultStartedAt: true,
          completedAt: true,
        },
      },
    },
  });
}

export type SessionData = NonNullable<Awaited<ReturnType<typeof loadSessionData>>>;

// ───────────── doctor history (for ETA) ─────────────

export type DoctorStats = {
  /** Median consultation minutes over the doctor's last 30 sessions (null if none). */
  medianConsultMinutes: number | null;
  /** Median arrival delay in minutes over the last 30 sessions (null if none). */
  medianArrivalDelayMinutes: number | null;
};

const HISTORY_SESSIONS = 30;
const STATS_TTL_MS = 10 * 60_000;
const statsCache = ((globalThis as unknown as { liveserialStats?: Map<string, { at: number; stats: DoctorStats }> })
  .liveserialStats ??= new Map());

/** Consultation length in minutes: completed − (entered ?? called). */
export function consultMinutes(t: { calledAt: Date | null; consultStartedAt: Date | null; completedAt: Date | null }) {
  const start = t.consultStartedAt ?? t.calledAt;
  if (!start || !t.completedAt) return null;
  const m = (t.completedAt.getTime() - start.getTime()) / 60_000;
  // Under 1 minute is a mis-tap (double "next"), over 3 hours a forgotten tap: neither is a real consultation.
  return m >= 1 && m < 180 ? m : null;
}

/** History is recomputed at most every 10 minutes per doctor (it barely moves within a day). */
export async function getDoctorStats(doctorId: string, excludeSessionId: string): Promise<DoctorStats> {
  const key = `${doctorId}|${excludeSessionId}`;
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.at < STATS_TTL_MS) return hit.stats;

  const sessions = await prisma.session.findMany({
    where: { doctorId, id: { not: excludeSessionId }, doctorArrivedAt: { not: null } },
    orderBy: { scheduledStartAt: "desc" },
    take: HISTORY_SESSIONS,
    select: {
      scheduledStartAt: true,
      doctorArrivedAt: true,
      tokens: {
        where: { completedAt: { not: null } },
        select: { calledAt: true, consultStartedAt: true, completedAt: true },
      },
    },
  });
  const delays = sessions.map((s) => (s.doctorArrivedAt!.getTime() - s.scheduledStartAt.getTime()) / 60_000);
  const consults = sessions.flatMap((s) => s.tokens.map(consultMinutes).filter((m): m is number => m !== null));
  const stats = { medianConsultMinutes: median(consults), medianArrivalDelayMinutes: median(delays) };
  statsCache.set(key, { at: Date.now(), stats });
  return stats;
}

/** This session's completed consultations, oldest → newest, in minutes. */
function sessionConsults(d: SessionData): number[] {
  return d.tokens
    .filter((t) => t.status === "DONE" && t.completedAt)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime())
    .map(consultMinutes)
    .filter((m): m is number => m !== null);
}

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
  features: Pick<FeatureFlags, "CONSOLE_UNDO" | "CONSOLE_LOOKUP">;
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
    features: { CONSOLE_UNDO: d.features.CONSOLE_UNDO, CONSOLE_LOOKUP: d.features.CONSOLE_LOOKUP },
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
  features: Pick<FeatureFlags, "DISPLAY_CHIME" | "DISPLAY_ANNOUNCE" | "DISPLAY_CONTROLS">;
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
    features: {
      DISPLAY_CHIME: d.features.DISPLAY_CHIME,
      DISPLAY_ANNOUNCE: d.features.DISPLAY_ANNOUNCE,
      DISPLAY_CONTROLS: d.features.DISPLAY_CONTROLS,
    },
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
    /** Estimated wait as a range in minutes (0–0 = any moment). Null unless WAITING. */
    eta: { low: number; high: number; doctorArrived: boolean } | null;
  };
  leaveNowThreshold: number;
  /** Patients already seen in this sitting (a count only) — for the progress bar. */
  doneCount: number;
  features: Pick<FeatureFlags, "PATIENT_PROGRESS" | "PATIENT_ALERT" | "PATIENT_UPDATED_AGO">;
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
  const eta =
    ahead === null
      ? null
      : computeEta({
          now,
          peopleAhead: ahead,
          scheduledStartAt: d.scheduledStartAt,
          doctorArrivedAt: d.doctorArrivedAt,
          announcedDelayMinutes: d.announcedDelayMinutes,
          sessionConsultMinutes: sessionConsults(d),
          doctorMedianConsultMinutes: d.stats.medianConsultMinutes,
          doctorMedianArrivalDelayMinutes: d.stats.medianArrivalDelayMinutes,
        });
  return {
    v: d.queueVersion,
    session,
    nowServing: nowServing(d.tokens)?.serial ?? null,
    you: {
      serial: me.serial,
      status: me.status,
      peopleAhead: ahead,
      leaveNow: ahead !== null && ahead <= d.chamber.leaveNowThreshold,
      eta: eta ? { low: eta.low, high: eta.high, doctorArrived: eta.doctorArrived } : null,
    },
    leaveNowThreshold: d.chamber.leaveNowThreshold,
    doneCount: d.tokens.filter((t) => t.status === "DONE").length,
    features: {
      PATIENT_PROGRESS: d.features.PATIENT_PROGRESS,
      PATIENT_ALERT: d.features.PATIENT_ALERT,
      PATIENT_UPDATED_AGO: d.features.PATIENT_UPDATED_AGO,
    },
    serverTime: now.toISOString(),
  };
}

/** Session id for a patient link, or null. */
export async function sessionIdForCode(publicCode: string): Promise<string | null> {
  if (!/^[2-9a-hj-km-np-zA-HJ-NP-Z]{8,16}$/.test(publicCode)) return null;
  const t = await prisma.token.findUnique({ where: { publicCode }, select: { sessionId: true } });
  return t?.sessionId ?? null;
}
