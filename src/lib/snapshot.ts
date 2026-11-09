import { prisma } from "@/lib/db";
import { AWAY, byQueueOrder, nowServing, waitingInOrder } from "@/lib/queue";
import type { SessionStatus, TokenStatus } from "@/generated/prisma/enums";

/**
 * Read models. The console view is for staff only (it includes names and
 * phones). Patient and display views (Phase 3) will expose serials only.
 */

export type ConsoleToken = {
  id: string;
  serial: number;
  name: string;
  phone: string | null;
  status: TokenStatus;
  isEmergency: boolean;
};

export type ConsoleView = {
  session: {
    id: string;
    status: SessionStatus;
    doctorName: string;
    chamberName: string;
    scheduledStartAt: string;
    doctorArrivedAt: string | null;
    announcedDelayMinutes: number | null;
    queueVersion: number;
  };
  current: ConsoleToken | null;
  waiting: ConsoleToken[];
  away: ConsoleToken[];
  doneCount: number;
  cancelledCount: number;
  total: number;
  serverTime: string;
};

export async function getConsoleView(orgId: string, sessionId: string): Promise<ConsoleView | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, organizationId: orgId },
    include: { doctor: { select: { name: true } }, chamber: { select: { name: true } }, tokens: true },
  });
  if (!session) return null;

  const toView = (t: (typeof session.tokens)[number]): ConsoleToken => ({
    id: t.id,
    serial: t.serial,
    name: t.patientName,
    phone: t.patientPhone,
    status: t.status,
    isEmergency: t.isEmergency,
  });
  const current = nowServing(session.tokens);

  return {
    session: {
      id: session.id,
      status: session.status,
      doctorName: session.doctor.name,
      chamberName: session.chamber.name,
      scheduledStartAt: session.scheduledStartAt.toISOString(),
      doctorArrivedAt: session.doctorArrivedAt?.toISOString() ?? null,
      announcedDelayMinutes: session.announcedDelayMinutes,
      queueVersion: session.queueVersion,
    },
    current: current ? toView(current) : null,
    waiting: waitingInOrder(session.tokens).map(toView),
    away: session.tokens
      .filter((t) => AWAY.includes(t.status))
      .sort(byQueueOrder)
      .map(toView),
    doneCount: session.tokens.filter((t) => t.status === "DONE").length,
    cancelledCount: session.tokens.filter((t) => t.status === "CANCELLED").length,
    total: session.tokens.length,
    serverTime: new Date().toISOString(),
  };
}
