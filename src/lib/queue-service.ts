import { prisma } from "@/lib/db";
import {
  ACTIVE,
  AWAY,
  CLOSED_SESSION,
  generatePublicCode,
  jumpedSerials,
  nextToCall,
  nowServing,
  requeueOrder,
  sessionTransition,
  type DoctorStatusAction,
  type OutOfOrderReasonCode,
  type RequeueMode,
} from "@/lib/queue";
import type { Prisma, QueueAction, Session, SessionStatus, Token, TokenStatus } from "@/generated/prisma/client";

/**
 * Every change to a session's queue goes through runQueueAction:
 *   lock the session row → replay if this client request was already applied →
 *   apply → bump queueVersion → NOTIFY → remember the request id → commit.
 * The rules themselves live in lib/queue.ts (pure, unit-tested).
 */

export type QueueErrorCode =
  | "NOT_FOUND"
  | "SESSION_CLOSED"
  | "INVALID"
  | "SERIAL_TAKEN"
  /** Someone else changed "now serving" first; the client must refresh. */
  | "CONFLICT"
  /** Nobody waiting and nobody inside. */
  | "EMPTY"
  | "REASON_REQUIRED";

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

// ───────────── helpers (inside a locked transaction) ─────────────

function assertOpen(session: Session) {
  if (CLOSED_SESSION.includes(session.status)) throw new QueueError("SESSION_CLOSED");
}

async function sessionTokens(tx: Tx, sessionId: string): Promise<Token[]> {
  return tx.token.findMany({ where: { sessionId } });
}

function findToken(tokens: Token[], tokenId: string): Token {
  const token = tokens.find((t) => t.id === tokenId);
  if (!token) throw new QueueError("NOT_FOUND");
  return token;
}

type EventInput = {
  action: QueueAction;
  token?: Token | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  isOutOfOrder?: boolean;
  reason?: OutOfOrderReasonCode | null;
  note?: string | null;
  meta?: Prisma.InputJsonValue;
};

async function logEvent(tx: Tx, ctx: QueueCtx, e: EventInput) {
  await tx.queueEvent.create({
    data: {
      organizationId: ctx.orgId,
      sessionId: ctx.sessionId,
      tokenId: e.token?.id ?? null,
      actorId: ctx.userId,
      action: e.action,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      isOutOfOrder: e.isOutOfOrder ?? false,
      reason: e.reason ?? null,
      note: e.note ?? null,
      meta: e.meta,
      clientRequestId: ctx.clientRequestId,
    },
  });
}

async function setTokenStatus(
  tx: Tx,
  ctx: QueueCtx,
  token: Token,
  to: TokenStatus,
  action: QueueAction,
  extra: Partial<Pick<Token, "calledAt" | "consultStartedAt" | "completedAt" | "queueOrder">> = {},
  event: Omit<EventInput, "action" | "token" | "fromStatus" | "toStatus"> = {},
) {
  await tx.token.update({ where: { id: token.id }, data: { status: to, ...extra } });
  await logEvent(tx, ctx, { action, token, fromStatus: token.status, toStatus: to, ...event });
  token.status = to;
}

/** Calling a patient means the doctor is seeing patients: move the session to RUNNING. */
async function ensureRunning(tx: Tx, ctx: QueueCtx, session: Session, now: Date) {
  if (session.status === "RUNNING") return;
  await tx.session.update({
    where: { id: session.id },
    data: { status: "RUNNING", doctorArrivedAt: session.doctorArrivedAt ?? now },
  });
  await logEvent(tx, ctx, {
    action: "SESSION_STATUS_CHANGED",
    fromStatus: session.status,
    toStatus: "RUNNING",
    meta: { auto: true, arrivedNow: !session.doctorArrivedAt },
  });
  session.status = "RUNNING";
}

/** Shared by next / call-out-of-order: verify "now serving" is what the client saw. */
function checkExpectedCurrent(tokens: Token[], expectedCurrentTokenId: string | null) {
  const current = nowServing(tokens);
  if ((current?.id ?? null) !== expectedCurrentTokenId) throw new QueueError("CONFLICT");
  return current;
}

async function completeCurrent(tx: Tx, ctx: QueueCtx, current: Token | undefined, now: Date) {
  if (current) await setTokenStatus(tx, ctx, current, "DONE", "MARK_DONE", { completedAt: now });
}

// ───────────── Calling patients ─────────────

export type CallResult = { calledSerial: number | null; completedSerial: number | null };

/**
 * "পরের রোগী ডাকুন": finish whoever is inside and call the next waiting patient.
 * `expectedCurrentTokenId` is the now-serving token the client was showing (or
 * null). If it changed, someone else already advanced → CONFLICT, nothing happens.
 */
export async function callNext(ctx: QueueCtx, expectedCurrentTokenId: string | null): Promise<CallResult> {
  return runQueueAction(ctx, "CALL_NEXT", async (tx, session) => {
    assertOpen(session);
    const tokens = await sessionTokens(tx, session.id);
    const current = checkExpectedCurrent(tokens, expectedCurrentTokenId);
    const next = nextToCall(tokens.filter((t) => t.id !== current?.id));
    if (!current && !next) throw new QueueError("EMPTY");

    const now = new Date();
    await completeCurrent(tx, ctx, current, now);
    if (next) {
      await ensureRunning(tx, ctx, session, now);
      await setTokenStatus(tx, ctx, next, "CALLED", "CALL_NEXT", { calledAt: now }, { meta: { serial: next.serial } });
    }
    return { calledSerial: next?.serial ?? null, completedSerial: current?.serial ?? null };
  });
}

/**
 * Call a specific waiting patient. If anyone is ahead of them in line this is an
 * out-of-order call: a reason is required (OTHER also needs a note), and the
 * jumped serials are recorded for the report.
 */
export async function callToken(
  ctx: QueueCtx,
  input: {
    tokenId: string;
    expectedCurrentTokenId: string | null;
    reason?: OutOfOrderReasonCode | null;
    note?: string | null;
  },
): Promise<CallResult & { outOfOrder: boolean }> {
  return runQueueAction(ctx, "CALL_TOKEN", async (tx, session) => {
    assertOpen(session);
    const tokens = await sessionTokens(tx, session.id);
    const current = checkExpectedCurrent(tokens, input.expectedCurrentTokenId);
    const target = findToken(tokens, input.tokenId);
    if (target.status !== "WAITING") throw new QueueError("INVALID", `Cannot call ${target.status}`);

    const jumped = jumpedSerials(target, tokens);
    const outOfOrder = jumped.length > 0;
    const note = input.note?.trim() || null;
    if (outOfOrder && (!input.reason || (input.reason === "OTHER" && !note))) throw new QueueError("REASON_REQUIRED");

    const now = new Date();
    await completeCurrent(tx, ctx, current, now);
    await ensureRunning(tx, ctx, session, now);
    if (outOfOrder) {
      await setTokenStatus(
        tx,
        ctx,
        target,
        "CALLED",
        "CALL_OUT_OF_ORDER",
        { calledAt: now },
        { isOutOfOrder: true, reason: input.reason, note, meta: { serial: target.serial, jumpedSerials: jumped } },
      );
    } else {
      await setTokenStatus(tx, ctx, target, "CALLED", "CALL_NEXT", { calledAt: now }, { meta: { serial: target.serial } });
    }
    return { calledSerial: target.serial, completedSerial: current?.serial ?? null, outOfOrder };
  });
}

// ───────────── Per-token actions ─────────────

type TokenAction = "IN_CONSULT" | "DONE" | "SKIP" | "NO_SHOW";

const TOKEN_ACTIONS: Record<TokenAction, { from: TokenStatus[]; to: TokenStatus; event: QueueAction }> = {
  IN_CONSULT: { from: ["CALLED"], to: "IN_CONSULT", event: "MARK_IN_CONSULT" },
  DONE: { from: ["CALLED", "IN_CONSULT"], to: "DONE", event: "MARK_DONE" },
  SKIP: { from: ["WAITING"], to: "SKIPPED", event: "SKIP" },
  NO_SHOW: { from: ["CALLED"], to: "NO_SHOW", event: "NO_SHOW" },
};

/**
 * - IN_CONSULT: optional "ভিতরে গেছেন" tap (better consultation timing).
 * - DONE: finish the patient inside without calling anyone (e.g. the last one).
 * - SKIP: a waiting patient stepped out; they can be re-queued later.
 * - NO_SHOW: the called patient isn't here.
 */
export async function tokenAction(ctx: QueueCtx, tokenId: string, action: TokenAction): Promise<{ serial: number }> {
  return runQueueAction(ctx, action, async (tx, session) => {
    assertOpen(session);
    const tokens = await sessionTokens(tx, session.id);
    const token = findToken(tokens, tokenId);
    const rule = TOKEN_ACTIONS[action];
    if (!rule.from.includes(token.status)) throw new QueueError("INVALID", `${action} not allowed from ${token.status}`);
    const now = new Date();
    const extra =
      action === "IN_CONSULT" ? { consultStartedAt: now } : action === "DONE" ? { completedAt: now } : {};
    await setTokenStatus(tx, ctx, token, rule.to, rule.event, extra);
    return { serial: token.serial };
  });
}

/** A skipped / no-show patient is back: put them after the current patient or at the end. */
export async function requeue(ctx: QueueCtx, tokenId: string, mode: RequeueMode): Promise<{ serial: number }> {
  return runQueueAction(ctx, "REQUEUE", async (tx, session) => {
    assertOpen(session);
    const tokens = await sessionTokens(tx, session.id);
    const token = findToken(tokens, tokenId);
    if (!AWAY.includes(token.status)) throw new QueueError("INVALID", `Cannot re-queue ${token.status}`);
    const queueOrder = requeueOrder(mode, tokens);
    await setTokenStatus(
      tx,
      ctx,
      token,
      "WAITING",
      mode === "AFTER_CURRENT" ? "REQUEUE_AFTER_CURRENT" : "REQUEUE_AT_END",
      { queueOrder, calledAt: null },
      { meta: { serial: token.serial, queueOrder } },
    );
    return { serial: token.serial };
  });
}

// ───────────── Session / doctor status ─────────────

export async function setDoctorStatus(ctx: QueueCtx, action: DoctorStatusAction): Promise<{ status: SessionStatus }> {
  return runQueueAction(ctx, `DOCTOR_${action}`, async (tx, session) => {
    const to = sessionTransition(action, session.status);
    if (!to) throw new QueueError(CLOSED_SESSION.includes(session.status) ? "SESSION_CLOSED" : "INVALID");
    const now = new Date();

    if (action === "END") {
      // Whoever is inside is finished; waiting patients stay WAITING (they were not seen).
      const current = nowServing(await sessionTokens(tx, session.id));
      await completeCurrent(tx, ctx, current, now);
    }
    await tx.session.update({
      where: { id: session.id },
      data: {
        status: to,
        ...(to === "DOCTOR_ARRIVED" ? { doctorArrivedAt: now } : {}),
        ...(to === "ENDED" ? { endedAt: now } : {}),
      },
    });
    await logEvent(tx, ctx, { action: "SESSION_STATUS_CHANGED", fromStatus: session.status, toStatus: to });
    return { status: to };
  });
}

/** "Running late by N minutes" (0 clears it). Feeds the ETA in Phase 4. */
export async function setDelay(ctx: QueueCtx, minutes: number): Promise<{ minutes: number }> {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 300) throw new QueueError("INVALID", "Bad delay");
  return runQueueAction(ctx, "SET_DELAY", async (tx, session) => {
    assertOpen(session);
    await tx.session.update({ where: { id: session.id }, data: { announcedDelayMinutes: minutes || null } });
    await logEvent(tx, ctx, {
      action: "DELAY_SET",
      meta: { minutes, previous: session.announcedDelayMinutes ?? 0 },
    });
    return { minutes };
  });
}

/** Cancels a whole sitting (e.g. doctor not coming). */
export async function cancelSession(ctx: QueueCtx): Promise<{ id: string }> {
  return runQueueAction(ctx, "CANCEL_SESSION", async (tx, session) => {
    assertOpen(session);
    await tx.session.update({ where: { id: session.id }, data: { status: "CANCELLED", endedAt: new Date() } });
    await logEvent(tx, ctx, { action: "SESSION_STATUS_CHANGED", fromStatus: session.status, toStatus: "CANCELLED" });
    return { id: session.id };
  });
}

// ───────────── Adding / editing tokens ─────────────

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
    assertOpen(session);
    const tokens = await sessionTokens(tx, session.id);
    const taken = new Set(tokens.map((r) => r.serial));
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
      await logEvent(tx, ctx, {
        action: "TOKEN_ADDED",
        token,
        toStatus: token.status,
        meta: { serial, explicitSerial: p.serial !== undefined, emergency: token.isEmergency },
      });
      added.push({ id: token.id, serial, publicCode: token.publicCode });
    }

    await tx.session.update({ where: { id: session.id }, data: { nextSerial: next } });
    return added;
  });
}

const EDITABLE: TokenStatus[] = ["WAITING", ...ACTIVE, ...AWAY];

export async function editToken(
  ctx: QueueCtx,
  tokenId: string,
  changes: { name: string; phone: string | null; isEmergency: boolean },
): Promise<{ id: string }> {
  return runQueueAction(ctx, "EDIT_TOKEN", async (tx, session) => {
    assertOpen(session);
    const token = findToken(await sessionTokens(tx, session.id), tokenId);
    if (!EDITABLE.includes(token.status)) throw new QueueError("SESSION_CLOSED");

    const before = { name: token.patientName, phone: token.patientPhone, emergency: token.isEmergency };
    const after = { name: changes.name, phone: changes.phone, emergency: changes.isEmergency };
    await tx.token.update({
      where: { id: token.id },
      data: { patientName: changes.name, patientPhone: changes.phone, isEmergency: changes.isEmergency },
    });
    await logEvent(tx, ctx, {
      action: "TOKEN_EDITED",
      token,
      fromStatus: token.status,
      toStatus: token.status,
      meta: { before, after },
    });
    return { id: token.id };
  });
}

const CANCELLABLE: TokenStatus[] = ["WAITING", ...AWAY];

export async function cancelToken(ctx: QueueCtx, tokenId: string): Promise<{ id: string }> {
  return runQueueAction(ctx, "CANCEL_TOKEN", async (tx, session) => {
    assertOpen(session);
    const token = findToken(await sessionTokens(tx, session.id), tokenId);
    if (!CANCELLABLE.includes(token.status)) throw new QueueError("INVALID", `Cannot cancel ${token.status}`);
    await setTokenStatus(tx, ctx, token, "CANCELLED", "TOKEN_CANCELLED");
    return { id: token.id };
  });
}
