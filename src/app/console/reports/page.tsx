import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { DailyReportView, ReportDateForm } from "@/components/daily-report";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { dateOnly, dhakaDateString, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { getDailyReport } from "@/lib/reports";
import { doctorNav } from "../doctor-nav";

export const metadata: Metadata = { title: t.report.ownTitle };

/** A doctor's own daily report (their sittings only). */
export default async function DoctorReportsPage({ searchParams }: PageProps<"/console/reports">) {
  const { user, orgId } = await requireOrgUser(["DOCTOR"]);
  const today = dhakaDateString();
  const q = await searchParams;
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
  const report = user.doctor ? await getDailyReport(orgId, date, user.doctor.id) : null;

  return (
    <AppShell user={user} nav={doctorNav}>
      <PageHeader title={t.report.ownTitle} subtitle={formatDate(dateOnly(date))} />
      <ReportDateForm date={date} max={today} />
      {report ? <DailyReportView report={report} /> : <EmptyState>{t.report.empty}</EmptyState>}
    </AppShell>
  );
}
