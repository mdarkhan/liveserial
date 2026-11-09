import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, cx, EmptyState, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { addDays, bn, dateOnly, dhakaDateString, dhakaWallTimeToUtc, formatDate, formatTime, weekdayOf } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { sessionTone } from "@/lib/status";
import type { SessionStatus } from "@/generated/prisma/enums";
import { openSitting } from "./actions";

export const metadata: Metadata = { title: t.console.title };

type Row = {
  key: string;
  startAt: Date;
  doctorName: string;
  chamberName: string;
  status: SessionStatus;
  patients: number;
  sessionId?: string;
  templateId?: string;
};

/** Sittings for a day: existing sessions + active schedules that have no session yet. */
export default async function ConsoleHome({ searchParams }: PageProps<"/console">) {
  const { user, orgId } = await requireOrgUser(["ORG_ADMIN", "ASSISTANT", "DOCTOR"]);
  const today = dhakaDateString();
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i));
  const q = await searchParams;
  const date = typeof q.date === "string" && days.includes(q.date) ? q.date : today;
  const doctorFilter = user.role === "DOCTOR" ? { doctorId: user.doctor?.id ?? "-" } : {};
  const canOpen = user.role !== "DOCTOR";

  const [sessions, templates] = await Promise.all([
    prisma.session.findMany({
      where: { organizationId: orgId, date: dateOnly(date), ...doctorFilter },
      include: {
        doctor: { select: { name: true } },
        chamber: { select: { name: true } },
        _count: { select: { tokens: { where: { status: { not: "CANCELLED" } } } } },
      },
    }),
    canOpen
      ? prisma.scheduleTemplate.findMany({
          where: {
            organizationId: orgId,
            weekday: weekdayOf(date),
            isActive: true,
            doctor: { isActive: true },
            chamber: { isActive: true },
          },
          include: { doctor: { select: { name: true } }, chamber: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const rows: Row[] = sessions.map((s) => ({
    key: s.id,
    startAt: s.scheduledStartAt,
    doctorName: s.doctor.name,
    chamberName: s.chamber.name,
    status: s.status,
    patients: s._count.tokens,
    sessionId: s.id,
  }));
  const taken = new Set(sessions.map((s) => `${s.doctorId}|${s.scheduledStartAt.getTime()}`));
  for (const tpl of templates) {
    const startAt = dhakaWallTimeToUtc(date, tpl.startTime);
    if (taken.has(`${tpl.doctorId}|${startAt.getTime()}`)) continue;
    rows.push({
      key: tpl.id,
      startAt,
      doctorName: tpl.doctor.name,
      chamberName: tpl.chamber.name,
      status: "NOT_STARTED",
      patients: 0,
      templateId: tpl.id,
    });
  }
  rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  return (
    <AppShell user={user}>
      <PageHeader title={date === today ? t.console.title : t.console.titleFor} subtitle={formatDate(dateOnly(date))} />

      <nav aria-label={t.common.date} className="mb-4 flex flex-wrap gap-2">
        {days.map((d, i) => (
          <Link
            key={d}
            href={i === 0 ? "/console" : `/console?date=${d}`}
            aria-current={d === date ? "date" : undefined}
            className={cx(
              "inline-flex min-h-12 items-center rounded-lg border-2 px-3 font-medium",
              d === date ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink hover:bg-primary-soft",
            )}
          >
            {i === 0 ? t.console.today : i === 1 ? t.console.tomorrow : `${t.weekdaysShort[weekdayOf(d)]} ${bn(Number(d.slice(8)))}`}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState>{t.session.empty}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{r.doctorName}</span>
                  <span className="block text-ink-muted">
                    {formatTime(r.startAt)} · {r.chamberName}
                  </span>
                  <span className="block text-ink-muted">
                    {t.session.patients}: <span className="tabular">{bn(r.patients)}</span>
                  </span>
                </span>
                <Badge tone={sessionTone(r.status)}>{t.sessionStatus[r.status]}</Badge>
                <span aria-hidden="true" className="text-2xl text-primary">
                  ›
                </span>
              </>
            );
            const cardClass =
              "flex w-full min-h-20 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left hover:border-primary";
            return (
              <li key={r.key}>
                {r.sessionId ? (
                  <Link href={`/console/${r.sessionId}`} className={cardClass}>
                    {body}
                  </Link>
                ) : (
                  <form action={openSitting}>
                    <input type="hidden" name="templateId" value={r.templateId} />
                    <input type="hidden" name="date" value={date} />
                    <button type="submit" className={cardClass}>
                      {body}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
