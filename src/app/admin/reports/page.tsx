import type { Metadata } from "next";
import { DailyReportView, ReportDateForm } from "@/components/daily-report";
import { PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { dateOnly, dhakaDateString, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { getDailyReport } from "@/lib/reports";

export const metadata: Metadata = { title: t.report.title };

export default async function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const today = dhakaDateString();
  const q = await searchParams;
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
