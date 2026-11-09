import { prisma } from "@/lib/db";
import { generatePublicCode } from "@/lib/queue";
import type { Prisma, Session, SessionStatus, TokenStatus } from "@/generated/prisma/client";

/**
 * Every change to a session's queue goes through runQueueAction:
 *   lock the session row → replay if this client request was already applied →
 *   apply → bump queueVersion → NOTIFY → remember the request id → commit.
 * Phase 1 implements token add / edit / cancel and session cancel; the call
 * actions (next, skip, no-show, re-queue, out-of-order) arrive in Phase 2.
 */

export type QueueErrorCode = "NOT_FOUND" | "SESSION_CLOSED" | "INVALID" | "SERIAL_TAKEN" | "CONFLICT";

export class QueueError extends Error {
  constructor(
    public code: QueueErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type QueueCtx = {
  orgId: string;
  userId: string;
  sessionId: string;
  /** Client-generated UUID; a retry with the same id returns the first result. */
  clientRequestId: string;
};

type Tx = Prisma.TransactionClient;

export const NOTIFY_CHANNEL = "liveserial";
const CLOSED: SessionStatus[] = ["ENDED", "CANCELLED"];

export async function runQueueAction<T extends Prisma.InputJsonValue>(
  ctx: QueueCtx,
  action: string,
  fn: (tx: Tx, session: Session) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(ctx.clientRequestId)) throw new QueueError("INVALID", "Bad client request id");

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Session"
      WHERE id = ${ctx.sessionId} AND "organizationId" = ${ctx.orgId}
      FOR UPDATE`;
    if (locked.length === 0) throw new QueueError("NOT_FOUND");

    // Checked after taking the lock, so two concurrent retries can't both pass.
    const prior = await tx.clientRequest.findUnique({ where: { id: ctx.clientRequestId } });
    if (prior) {
      if (prior.organizationId !== ctx.orgId || prior.userId !== ctx.userId) throw new QueueError("INVALID");
      return prior.response as T;
    }

    const session = await tx.session.findUniqueOrThrow({ where: { id: ctx.sessionId } });
    const result = await fn(tx, session);

    const { queueVersion } = await tx.session.update({
      where: { id: ctx.sessionId },
      data: { queueVersion: { increment: 1 } },
      select: { queueVersion: true },
    });
    const payload = JSON.stringify({ s: ctx.sessionId, v: queueVersion });
    await tx.$executeRaw`SELECT pg_notify(${NOTIFY_CHANNEL}, ${payload})`;

    await tx.clientRequest.create({
      data: { id: ctx.clientRequestId, organizationId: ctx.orgId, userId: ctx.userId, action, response: result },
    });
    return result;
  });
}

// ───────────── Token actions ─────────────

export type NewPatient = {
  name: string;
  /** Normalized 8801XXXXXXXXX or null. */
  phone: string | null;
  /** Explicit serial (phone bookings already numbered); otherwise the next free one. */
  serial?: number;
  isEmergency?: boolean;
};

export type AddedToken = { id: string; serial: number; publicCode: string };

export async function addTokens(ctx: QueueCtx, patients: NewPatient[]): Promise<AddedToken[]> {
  if (patients.length === 0) throw new QueueError("INVALID", "No patients");
  return runQueueAction(ctx, "ADD_TOKENS", async (tx, session) => {
    if (CLOSED.includes(session.status)) throw new QueueError("SESSION_CLOSED");

    const taken = new Set(
      (await tx.token.findMany({ where: { sessionId: session.id }, select: { serial: true } })).map((r) => r.serial),
    );
    let next = session.nextSerial;
    const added: AddedToken[] = [];

    for (const p of patients) {
      let serial: number;
      if (p.serial !== undefined) {
        if (!Number.isInteger(p.serial) || p.serial < 1) throw new QueueError("INVALID", "Bad serial");
        if (taken.has(p.serial)) throw new QueueError("SERIAL_TAKEN", String(p.serial));
        serial = p.serial;
      } else {
        while (taken.has(next)) next++;
        serial = next;
      }
      taken.add(serial);
      next = Math.max(next, serial + 1);

      const token = await tx.token.create({
        data: {
          organizationId: ctx.orgId,
          sessionId: session.id,
          serial,
          queueOrder: serial,
          patientName: p.name,
          patientPhone: p.phone,
          isEmergency: p.isEmergency ?? false,
          publicCode: generatePublicCode(),
          createdById: ctx.userId,
        },
      });
      await tx.queueEvent.create({
        data: {
          organizationId: ctx.orgId,
          sessionId: session.id,
          tokenId: token.id,
          actorId: ctx.userId,
          action: "TOKEN_ADDED",
          toStatus: token.status,
          meta: { serial, explicitSerial: p.serial !== undefined, emergency: token.isEmergency },
          clientRequestId: ctx.clientRequestId,
        },
      });
      added.push({ id: token.id, serial, publicCode: token.publicCode });
    }

    await tx.session.update({ where: { id: session.id }, data: { nextSerial: next } });
    return added;
  });
}

const EDITABLE: TokenStatus[] = ["WAITING", "CALLED", "IN_CONSULT", "SKIPPED", "NO_SHOW"];

export async function editToken(
  ctx: QueueCtx,
  tokenId: string,
  changes: { name: string; phone: string | null; isEmergency: boolean },
): Promise<{ id: string }> {
  return runQueueAction(ctx, "EDIT_TOKEN", async (tx, session) => {
    const token = await tx.token.findFirst({ where: { id: tokenId, sessionId: session.id, organizationId: ctx.orgId } });
    if (!token) throw new QueueError("NOT_FOUND");
    if (!EDITABLE.includes(token.status) || CLOSED.includes(session.status)) throw new QueueError("SESSION_CLOSED");

    const before = { name: token.patientName, phone: token.patientPhone, emergency: token.isEmergency };
    const after = { name: changes.name, phone: changes.phone, emergency: changes.isEmergency };
    await tx.token.update({
      where: { id: token.id },
      data: { patientName: changes.name, patientPhone: changes.phone, isEmergency: changes.isEmergency },
    });
    await tx.queueEvent.create({
      data: {
        organizationId: ctx.orgId,
        sessionId: session.id,
        tokenId: token.id,
        actorId: ctx.userId,
        action: "TOKEN_EDITED",
        fromStatus: token.status,
        toStatus: token.status,
        meta: { before, after },
        clientRequestId: ctx.clientRequestId,
      },
    });
    return { id: token.id };
  });
}

const CANCELLABLE: TokenStatus[] = ["WAITING", "SKIPPED", "NO_SHOW"];

export async function cancelToken(ctx: QueueCtx, tokenId: string): Promise<{ id: string }> {
  return runQueueAction(ctx, "CANCEL_TOKEN", async (tx, session) => {
    const token = await tx.token.findFirst({ where: { id: tokenId, sessionId: session.id, organizationId: ctx.orgId } });
    if (!token) throw new QueueError("NOT_FOUND");
    if (!CANCELLABLE.includes(token.status)) throw new QueueError("INVALID", `Cannot cancel ${token.status}`);
    await tx.token.update({ where: { id: token.id }, data: { status: "CANCELLED" } });
    await tx.queueEvent.create({
      data: {
        organizationId: ctx.orgId,
        sessionId: session.id,
        tokenId: token.id,
        actorId: ctx.userId,
        action: "TOKEN_CANCELLED",
        fromStatus: token.status,
        toStatus: "CANCELLED",
        clientRequestId: ctx.clientRequestId,
      },
    });
    return { id: token.id };
  });
}

/** Cancels a whole sitting (e.g. doctor not coming). Phase 2 adds the other status buttons. */
export async function cancelSession(ctx: QueueCtx): Promise<{ id: string }> {
  return runQueueAction(ctx, "CANCEL_SESSION", async (tx, session) => {
    if (CLOSED.includes(session.status)) throw new QueueError("SESSION_CLOSED");
    await tx.session.update({ where: { id: session.id }, data: { status: "CANCELLED", endedAt: new Date() } });
    await tx.queueEvent.create({
      data: {
        organizationId: ctx.orgId,
        sessionId: session.id,
        actorId: ctx.userId,
        action: "SESSION_STATUS_CHANGED",
        fromStatus: session.status,
        toStatus: "CANCELLED",
        clientRequestId: ctx.clientRequestId,
      },
    });
    return { id: session.id };
  });
}
