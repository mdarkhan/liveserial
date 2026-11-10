import { authorizeSessionApi } from "@/lib/access";
import { prisma } from "@/lib/db";
import { normalizeBdPhone } from "@/lib/format";
import { loadSessionData } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/**
 * Returning patient: GET ?phone=01711… → { ok, name } — the name on this
 * organization's most recent serial with that phone (or null).
 * Staff who can add patients only, and only where the super admin switched
 * CONSOLE_LOOKUP on for this sitting. Never looks outside the organization.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/sessions/[id]/lookup">) {
  const { id: sessionId } = await params;
  const auth = await authorizeSessionApi(sessionId, true);
  if ("error" in auth) return auth.error;

  const data = await loadSessionData(sessionId);
  if (!data || data.organizationId !== auth.orgId) {
    return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }
  if (!data.features.CONSOLE_LOOKUP) return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });

  const phone = normalizeBdPhone(new URL(request.url).searchParams.get("phone") ?? "");
  if (!phone) return Response.json({ ok: false, code: "BAD_PHONE" }, { status: 400 });

  const last = await prisma.token.findFirst({
    where: { organizationId: auth.orgId, patientPhone: phone, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: { patientName: true },
  });
  return Response.json({ ok: true, name: last?.patientName ?? null }, { headers: { "Cache-Control": "no-store" } });
}
