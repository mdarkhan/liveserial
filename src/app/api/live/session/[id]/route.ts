import { authorizeSessionApi } from "@/lib/access";
import { sseResponse, wantsJson } from "@/lib/realtime";
import { loadSessionData, projectConsole, projectDisplay } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Live session stream.
 *   ?view=display  → public waiting-room TV (serial numbers only; the session's
 *                    random UUID is the access key)
 *   ?view=console  → staff console (same auth as the console API)
 * Add ?once=1 for a single JSON snapshot (the 15 s polling fallback).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/live/session/[id]">) {
  const { id } = await params;
  const view = new URL(request.url).searchParams.get("view") === "console" ? "console" : "display";
  if (!UUID.test(id)) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

  let orgId: string | null = null;
  if (view === "console") {
    const auth = await authorizeSessionApi(id, false);
    if ("error" in auth) return auth.error;
    orgId = auth.orgId;
  }

  const data = await loadSessionData(id);
  if (!data || (orgId && data.organizationId !== orgId)) {
    return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  const project = view === "console" ? projectConsole : projectDisplay;
  if (wantsJson(request)) {
    return Response.json({ ok: true, view: project(data) }, { headers: { "Cache-Control": "no-store" } });
  }
  return sseResponse(request, id, data, (d) => project(d));
}
