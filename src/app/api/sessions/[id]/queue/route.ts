import { z } from "zod";
import { getSessionUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { normalizeBdPhone } from "@/lib/format";
import { OUT_OF_ORDER_REASONS } from "@/lib/queue";
import {
  addTokens,
  callNext,
  callToken,
  cancelToken,
  QueueError,
  requeue,
  setDelay,
  setDoctorStatus,
  tokenAction,
  type QueueCtx,
} from "@/lib/queue-service";
import { getConsoleView } from "@/lib/snapshot";

/**
 * Assistant console API.
 *   GET  → current console view (also the polling fallback).
 *   POST → one queue action { type, clientRequestId, ... } → { ok, result, view }.
 * Every POST is idempotent by clientRequestId (see queue-service.ts).
 */

const id = z.string().min(1).max(64);
const expected = z.string().min(1).max(64).nullable();

const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NEXT"), expectedCurrentTokenId: expected }),
  z.object({
    type: z.literal("CALL"),
    tokenId: id,
    expectedCurrentTokenId: expected,
    reason: z.enum(OUT_OF_ORDER_REASONS).nullable().optional(),
    note: z.string().max(300).nullable().optional(),
  }),
  z.object({ type: z.enum(["IN_CONSULT", "DONE", "SKIP", "NO_SHOW"]), tokenId: id }),
  z.object({ type: z.literal("REQUEUE"), tokenId: id, mode: z.enum(["AFTER_CURRENT", "AT_END"]) }),
  z.object({ type: z.literal("CANCEL"), tokenId: id }),
  z.object({ type: z.literal("DOCTOR"), action: z.enum(["ARRIVED", "BREAK", "RESUME", "END"]) }),
  z.object({ type: z.literal("DELAY"), minutes: z.number().int().min(0).max(300) }),
  z.object({
    type: z.literal("ADD"),
    patients: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          phone: z.string().max(40).nullable().optional(),
          serial: z.number().int().min(1).max(9999).optional(),
          isEmergency: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
]);

const bodySchema = z.intersection(z.object({ clientRequestId: z.string().uuid() }), actionSchema);

const ERROR_STATUS: Record<QueueError["code"], number> = {
  NOT_FOUND: 404,
  INVALID: 400,
  REASON_REQUIRED: 400,
  CONFLICT: 409,
  EMPTY: 409,
  SESSION_CLOSED: 409,
  SERIAL_TAKEN: 409,
};

async function authorize(sessionId: string, write: boolean) {
  const user = await getSessionUser();
  if (!user) return { error: Response.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 }) };
  if (!user.organizationId || user.role === "SUPER_ADMIN") {
    return { error: Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) };
  }
  if (user.role === "DOCTOR") {
    // Doctors see their own sessions, read-only.
    const own = await prisma.session.count({
      where: { id: sessionId, organizationId: user.organizationId, doctor: { userId: user.id } },
    });
    if (!own) return { error: Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 }) };
    if (write) return { error: Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 }) };
  }
  return { user, orgId: user.organizationId };
}

export async function GET(_req: Request, { params }: RouteContext<"/api/sessions/[id]/queue">) {
  const { id: sessionId } = await params;
  const auth = await authorize(sessionId, false);
  if ("error" in auth) return auth.error;
  const view = await getConsoleView(auth.orgId, sessionId);
  if (!view) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  return Response.json({ ok: true, view }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: RouteContext<"/api/sessions/[id]/queue">) {
  const { id: sessionId } = await params;
  const auth = await authorize(sessionId, true);
  if ("error" in auth) return auth.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });
  const body = parsed.data;
  const ctx: QueueCtx = {
    orgId: auth.orgId,
    userId: auth.user.id,
    sessionId,
    clientRequestId: body.clientRequestId,
  };

  try {
    let result: unknown;
    switch (body.type) {
      case "NEXT":
        result = await callNext(ctx, body.expectedCurrentTokenId);
        break;
      case "CALL":
        result = await callToken(ctx, body);
        break;
      case "IN_CONSULT":
      case "DONE":
      case "SKIP":
      case "NO_SHOW":
        result = await tokenAction(ctx, body.tokenId, body.type);
        break;
      case "REQUEUE":
        result = await requeue(ctx, body.tokenId, body.mode);
        break;
      case "CANCEL":
        result = await cancelToken(ctx, body.tokenId);
        break;
      case "DOCTOR":
        result = await setDoctorStatus(ctx, body.action);
        break;
      case "DELAY":
        result = await setDelay(ctx, body.minutes);
        break;
      case "ADD": {
        const patients = [];
        for (const [index, p] of body.patients.entries()) {
          const phone = p.phone?.trim() ? normalizeBdPhone(p.phone) : null;
          if (p.phone?.trim() && !phone) {
            return Response.json({ ok: false, code: "BAD_PHONE", index }, { status: 400 });
          }
          patients.push({ name: p.name, phone, serial: p.serial, isEmergency: p.isEmergency });
        }
        result = await addTokens(ctx, patients);
        break;
      }
    }
    const view = await getConsoleView(auth.orgId, sessionId);
    return Response.json({ ok: true, result, view });
  } catch (e) {
    if (e instanceof QueueError) {
      const view = e.code === "NOT_FOUND" ? null : await getConsoleView(auth.orgId, sessionId);
      return Response.json(
        { ok: false, code: e.code, detail: e.message, view },
        { status: ERROR_STATUS[e.code] },
      );
    }
    console.error("queue action failed", e);
    return Response.json({ ok: false, code: "SERVER_ERROR" }, { status: 500 });
  }
}
