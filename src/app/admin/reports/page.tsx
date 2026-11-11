import type { Metadata } from "next";
import { DailyReportView, ReportDateForm } from "@/components/daily-report";
import { CsvLinks, periodLabel, RangeReportView, ReportPeriodNav } from "@/components/range-report";
import { PageHeader } from "@/components/ui";
import { getSessionUser, requireOrgUser } from "@/lib/access";
import { resolveFeatures } from "@/lib/features";
import { dateOnly, dhakaDateString, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { parsePeriod, periodRange } from "@/lib/report-period";
import { getDailyReport, getRangeReport } from "@/lib/reports";

/** The browser tab says which period is shown ("সাপ্তাহিক রিপোর্ট", …). */
export async function generateMetadata({ searchParams }: PageProps<"/admin/reports">): Promise<Metadata> {
  const user = await getSessionUser();
  const period = resolveFeatures(user?.organization?.features).REPORTS_EXTENDED ? parsePeriod((await searchParams).period) : "day";
  return { title: period === "week" ? t.report.weekTitle : period === "month" ? t.report.monthTitle : t.report.title };
}

/**
 * Clinic admin reports. Daily by default; with REPORTS_EXTENDED switched on by
 * the super admin also weekly / monthly with charts, per-doctor totals and CSV.
 */
export default async function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const { user, orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const today = dhakaDateString();
  const q = await searchParams;

  if (!resolveFeatures(user.organization?.features).REPORTS_EXTENDED) {
    const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
    const report = await getDailyReport(orgId, date);
    return (
      <>
        <PageHeader title={t.report.title} subtitle={formatDate(dateOnly(date))} />
        <ReportDateForm date={date} max={today} />
        <DailyReportView report={report} sessionHref={(id) => `/admin/sessions/${id}`} />
      </>
    );
  }

  const range = periodRange(parsePeriod(q.period), q.date, today);
  const report = await getRangeReport(orgId, range.from, range.to);
  const title =
    range.period === "week" ? t.report.weekTitle : range.period === "month" ? t.report.monthTitle : t.report.title;
  const csvHref = (kind: string) => `/api/reports/csv?kind=${kind}&period=${range.period}&date=${range.anchor}`;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={range.period === "day" ? formatDate(dateOnly(range.from)) : periodLabel(range)}
      />
      <ReportPeriodNav base="/admin/reports" range={range} today={today} />
      {range.period === "day" ? (
        <DailyReportView report={report} sessionHref={(id) => `/admin/sessions/${id}`} />
      ) : (
        <RangeReportView report={report} showDoctors />
      )}
      {report.sessions.length > 0 && (
        <div className="mt-5">
          <CsvLinks csvHref={csvHref} />
        </div>
      )}
    </>
  );
}
