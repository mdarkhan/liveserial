import type { Metadata } from "next";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n/bn";
import { createDoctor, toggleDoctor, updateDoctor } from "../actions";

export const metadata: Metadata = { title: t.doctor.title };

export default async function DoctorsPage() {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const doctors = await prisma.doctor.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { user: { select: { name: true } } },
  });

  return (
    <>
      <PageHeader title={t.doctor.title} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div>
          {doctors.length === 0 ? (
            <EmptyState>{t.doctor.empty}</EmptyState>
          ) : (
            <List>
              {doctors.map((d) => (
                <ListItem key={d.id}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-sm text-ink-muted">
                      {d.specialty ?? t.common.none} · {t.doctor.loginUser}: {d.user?.name ?? t.doctor.noLogin}
                    </p>
                  </div>
                  <Badge tone={d.isActive ? "success" : "neutral"}>{d.isActive ? t.common.active : t.common.inactive}</Badge>
                  <details className="w-full">
                    <summary className="inline-flex min-h-12 items-center font-medium text-primary">{t.common.edit}</summary>
                    <div className="mt-2 space-y-3">
                      <ActionForm action={updateDoctor} resetOnSuccess={false}>
                        <input type="hidden" name="id" value={d.id} />
                        <Field name="name" label={t.doctor.name} defaultValue={d.name} required />
                        <Field name="specialty" label={t.doctor.specialty} defaultValue={d.specialty ?? ""} />
                        <SubmitButton pendingLabel={t.common.saving}>{t.common.save}</SubmitButton>
                      </ActionForm>
                      <form action={toggleDoctor}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="min-h-12 font-medium text-ink-muted underline">
                          {d.isActive ? t.common.deactivate : t.common.activate}
                        </button>
                      </form>
                    </div>
                  </details>
                </ListItem>
              ))}
            </List>
          )}
        </div>
        <Card>
          <CardTitle>{t.doctor.add}</CardTitle>
          <ActionForm action={createDoctor}>
            <Field name="name" label={t.doctor.name} hint={t.doctor.nameHint} required />
            <Field name="specialty" label={`${t.doctor.specialty} ${t.common.optional}`} />
            <SubmitButton pendingLabel={t.common.saving} className="w-full">
              {t.common.add}
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
