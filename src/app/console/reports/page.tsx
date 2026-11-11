import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { DailyReportView, ReportDateForm } from "@/components/daily-report";
import { CsvLinks, periodLabel, RangeReportView, ReportPeriodNav } from "@/components/range-report";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { resolveFeatures } from "@/lib/features";
import { dateOnly, dhakaDateString, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { parsePeriod, periodRange } from "@/lib/report-period";
import { getDailyReport, getRangeReport } from "@/lib/reports";
import { doctorNav } from "../doctor-nav";

export const metadata: Metadata = { title: t.report.ownTitle };

/** A doctor's own report (their sittings only): daily, or week / month where switched on. */
export default async function DoctorReportsPage({ searchParams }: PageProps<"/console/reports">) {
  const { user, orgId } = await requireOrgUser(["DOCTOR"]);
  const today = dhakaDateString();
  const q = await searchParams;
  const doctorId = user.doctor?.id;

  if (!resolveFeatures(user.organization?.features).REPORTS_EXTENDED) {
    const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
    const report = doctorId ? await getDailyReport(orgId, date, doctorId) : null;
    return (
      <AppShell user={user} nav={doctorNav}>
        <PageHeader title={t.report.ownTitle} subtitle={formatDate(dateOnly(date))} />
        <ReportDateForm date={date} max={today} />
        {report ? <DailyReportView report={report} /> : <EmptyState>{t.report.empty}</EmptyState>}
      </AppShell>
    );
  }

  const range = periodRange(parsePeriod(q.period), q.date, today);
  const report = doctorId ? await getRangeReport(orgId, range.from, range.to, doctorId) : null;
  const title =
    range.period === "week" ? t.report.ownWeekTitle : range.period === "month" ? t.report.ownMonthTitle : t.report.ownTitle;
  const csvHref = (kind: string) => `/api/reports/csv?kind=${kind}&period=${range.period}&date=${range.anchor}`;

  return (
    <AppShell user={user} nav={doctorNav}>
      <PageHeader
        title={title}
        subtitle={range.period === "day" ? formatDate(dateOnly(range.from)) : periodLabel(range)}
      />
      <ReportPeriodNav base="/console/reports" range={range} today={today} />
      {!report ? (
        <EmptyState>{t.report.empty}</EmptyState>
      ) : range.period === "day" ? (
        <DailyReportView report={report} />
      ) : (
        <RangeReportView report={report} showDoctors={false} />
      )}
      {report && report.sessions.length > 0 && (
        <div className="mt-5">
          <CsvLinks csvHref={csvHref} />
        </div>
      )}
    </AppShell>
  );
}
