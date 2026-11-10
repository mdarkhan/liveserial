import { z } from "zod";
import { patientNotComing, QueueError } from "@/lib/queue-service";
import { sseResponse, wantsJson } from "@/lib/realtime";
import { loadSessionData, projectPatient, sessionIdForCode } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/**
 * Live stream for one patient link. Public: the unguessable publicCode is the
 * access key, and the view holds only that patient's own serial and position.
 * Add ?once=1 for a single JSON snapshot (the 15 s polling fallback).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/live/t/[code]">) {
  const { code } = await params;
  const sessionId = await sessionIdForCode(code);
  const data = sessionId ? await loadSessionData(sessionId) : null;
  const view = data ? projectPatient(data, code) : null;
  if (!sessionId || !data || !view) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

  if (wantsJson(request)) {
    return Response.json({ ok: true, view }, { headers: { "Cache-Control": "no-store" } });
  }
  return sseResponse(request, sessionId, data, (d) => projectPatient(d, code));
}

const postSchema = z.object({ type: z.literal("NOT_COMING"), clientRequestId: z.string().uuid() });

/**
 * The patient's own action from their link: "আমি আসছি না". Only where the super
 * admin switched PATIENT_NOT_COMING on. Idempotent by clientRequestId.
 * Returns the fresh patient view.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/live/t/[code]">) {
  const { code } = await params;
  const sessionId = await sessionIdForCode(code);
  const before = sessionId ? await loadSessionData(sessionId) : null;
  if (!sessionId || !before || !projectPatient(before, code)) {
    return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }
  if (!before.features.PATIENT_NOT_COMING) return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, code: "BAD_REQUEST" }, { status: 400 });

  try {
    await patientNotComing(code, parsed.data.clientRequestId);
  } catch (e) {
    if (e instanceof QueueError) {
      const data = await loadSessionData(sessionId);
      return Response.json(
        { ok: false, code: e.code, view: data ? projectPatient(data, code) : null },
        { status: e.code === "NOT_FOUND" ? 404 : 409 },
      );
    }
    console.error("patient not-coming failed", e);
    return Response.json({ ok: false, code: "SERVER_ERROR" }, { status: 500 });
  }
  const data = await loadSessionData(sessionId);
  return Response.json({ ok: true, view: data ? projectPatient(data, code) : null });
}
