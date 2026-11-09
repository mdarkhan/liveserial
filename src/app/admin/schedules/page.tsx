import type { Metadata } from "next";
import { ActionForm, Field, SelectField, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatWallTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { createSchedule, toggleSchedule } from "../actions";

export const metadata: Metadata = { title: t.schedule.title };

export default async function SchedulesPage() {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const [schedules, doctors, chambers] = await Promise.all([
    prisma.scheduleTemplate.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isActive: "desc" }, { weekday: "asc" }, { startTime: "asc" }],
      include: { doctor: true, chamber: true },
    }),
    prisma.doctor.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.chamber.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader title={t.schedule.title} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div>
          {schedules.length === 0 ? (
            <EmptyState>{t.schedule.empty}</EmptyState>
          ) : (
            <List>
              {schedules.map((s) => (
                <ListItem key={s.id}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {t.weekdays[s.weekday]}, {formatWallTime(s.startTime)}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {s.doctor.name} · {s.chamber.name}
                    </p>
                  </div>
                  <Badge tone={s.isActive ? "success" : "neutral"}>{s.isActive ? t.common.active : t.common.inactive}</Badge>
                  <form action={toggleSchedule}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" className="min-h-12 px-2 font-medium text-primary underline">
                      {s.isActive ? t.common.deactivate : t.common.activate}
                    </button>
                  </form>
                </ListItem>
              ))}
            </List>
          )}
        </div>
        <Card>
          <CardTitle>{t.schedule.add}</CardTitle>
          {doctors.length === 0 || chambers.length === 0 ? (
            <p className="text-ink-muted">{doctors.length === 0 ? t.doctor.empty : t.chamber.empty}</p>
          ) : (
            <ActionForm action={createSchedule}>
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
              <SelectField
                name="weekday"
                label={t.schedule.weekday}
                required
                options={t.weekdays.map((w, i) => ({ value: String(i), label: w }))}
              />
              <Field name="startTime" label={t.schedule.startTime} type="time" defaultValue="17:00" required />
              <SubmitButton pendingLabel={t.common.saving} className="w-full">
                {t.common.add}
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
