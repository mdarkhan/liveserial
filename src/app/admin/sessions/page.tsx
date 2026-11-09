import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { Badge, buttonClass, Card, CardTitle, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { bn, dateOnly, dhakaDateString, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { sessionTone } from "@/lib/status";
import { createSession } from "../actions";

export const metadata: Metadata = { title: t.session.title };

export default async function SessionsPage({ searchParams }: PageProps<"/admin/sessions">) {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const q = await searchParams;
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : dhakaDateString();

  const [sessions, doctors, chambers] = await Promise.all([
    prisma.session.findMany({
      where: { organizationId: orgId, date: dateOnly(date) },
      orderBy: { scheduledStartAt: "asc" },
      include: {
        doctor: { select: { name: true } },
        chamber: { select: { name: true } },
        _count: { select: { tokens: { where: { status: { not: "CANCELLED" } } } } },
      },
    }),
    prisma.doctor.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.chamber.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title={t.session.title} subtitle={formatDate(dateOnly(date))} />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="flex-1 sm:flex-none">
          <span className="mb-1 block font-medium">{t.common.date}</span>
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="block min-h-12 w-full rounded-lg border-2 border-line-strong bg-surface px-3"
          />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          {t.session.showDate}
        </button>
      </form>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div>
          {sessions.length === 0 ? (
            <EmptyState>{t.session.empty}</EmptyState>
          ) : (
            <List>
              {sessions.map((s) => (
                <ListItem key={s.id}>
                  <Link href={`/admin/sessions/${s.id}`} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center">
                    <span className="font-semibold text-primary underline-offset-2 hover:underline">{s.doctor.name}</span>
                    <span className="text-sm text-ink-muted">
                      {formatTime(s.scheduledStartAt)} · {s.chamber.name} · {t.session.patients}:{" "}
                      <span className="tabular">{bn(s._count.tokens)}</span>
                    </span>
                  </Link>
                  <Badge tone={sessionTone(s.status)}>{t.sessionStatus[s.status]}</Badge>
                </ListItem>
              ))}
            </List>
          )}
        </div>
        <Card>
          <CardTitle>{t.session.add}</CardTitle>
          {doctors.length === 0 || chambers.length === 0 ? (
            <p className="text-ink-muted">{doctors.length === 0 ? t.doctor.empty : t.chamber.empty}</p>
          ) : (
            <ActionForm action={createSession}>
              <SelectField
                name="doctorId"
                label={t.session.doctor}
                required
                options={doctors.map((d) => ({ value: d.id, label: d.name }))}
              />
              <SelectField
                name="chamberId"
                label={t.session.chamber}
                required
                options={chambers.map((c) => ({ value: c.id, label: c.name }))}
              />
              <Field name="date" label={t.common.date} type="date" defaultValue={date} required />
              <Field name="startTime" label={t.session.scheduledStart} type="time" defaultValue="17:00" required />
              <SubmitButton pendingLabel={t.common.saving} className="w-full">
                {t.session.add}
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
