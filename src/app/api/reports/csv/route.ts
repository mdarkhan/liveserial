import { getSessionUser } from "@/lib/access";
import { outOfOrderCsv, sessionsCsv } from "@/lib/csv";
import { resolveFeatures } from "@/lib/features";
import { dhakaDateString } from "@/lib/format";
import { parsePeriod, periodRange } from "@/lib/report-period";
import { getRangeReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

/**
 * CSV download of a report period.
 *   ?kind=sessions|out-of-order&period=day|week|month&date=YYYY-MM-DD (or YYYY-MM)
 * Clinic admin: the whole organization. Doctor: their own sittings only.
 * Only where the super admin switched REPORTS_EXTENDED on.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (!user.organizationId || (user.role !== "ORG_ADMIN" && user.role !== "DOCTOR")) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  if (!resolveFeatures(user.organization?.features).REPORTS_EXTENDED) {
    return Response.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  const doctorId = user.role === "DOCTOR" ? user.doctor?.id : undefined;
  if (user.role === "DOCTOR" && !doctorId) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "out-of-order" ? "out-of-order" : "sessions";
  const range = periodRange(parsePeriod(url.searchParams.get("period")), url.searchParams.get("date"), dhakaDateString());
  const report = await getRangeReport(user.organizationId, range.from, range.to, doctorId);

  const body = kind === "sessions" ? sessionsCsv(report) : outOfOrderCsv(report);
  const span = range.from === range.to ? range.from : `${range.from}_${range.to}`;
  const filename = `liveserial-${kind}-${span}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
