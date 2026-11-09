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
