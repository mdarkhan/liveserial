import type { Metadata } from "next";
import { ActionForm, Field, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { bn } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { createChamber, toggleChamber, updateChamber } from "../actions";

export const metadata: Metadata = { title: t.chamber.title };

export default async function ChambersPage() {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const chambers = await prisma.chamber.findMany({
    where: { organizationId: orgId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader title={t.chamber.title} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div>
          {chambers.length === 0 ? (
            <EmptyState>{t.chamber.empty}</EmptyState>
          ) : (
            <List>
              {chambers.map((c) => (
                <ListItem key={c.id}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-ink-muted">
                      {c.address ?? t.common.none} · {t.chamber.threshold}: {bn(c.leaveNowThreshold)}
                    </p>
                  </div>
                  <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? t.common.active : t.common.inactive}</Badge>
                  <details className="w-full">
                    <summary className="inline-flex min-h-12 items-center font-medium text-primary">{t.common.edit}</summary>
                    <div className="mt-2 space-y-3">
                      <ActionForm action={updateChamber} resetOnSuccess={false}>
                        <input type="hidden" name="id" value={c.id} />
                        <ChamberFields name={c.name} address={c.address} threshold={c.leaveNowThreshold} />
                        <SubmitButton pendingLabel={t.common.saving}>{t.common.save}</SubmitButton>
                      </ActionForm>
                      <form action={toggleChamber}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="min-h-12 font-medium text-ink-muted underline">
                          {c.isActive ? t.common.deactivate : t.common.activate}
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
          <CardTitle>{t.chamber.add}</CardTitle>
          <ActionForm action={createChamber}>
            <ChamberFields />
            <SubmitButton pendingLabel={t.common.saving} className="w-full">
              {t.common.add}
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function ChamberFields({ name, address, threshold = 5 }: { name?: string; address?: string | null; threshold?: number }) {
  return (
    <>
      <Field name="name" label={t.chamber.name} defaultValue={name} required />
      <Field name="address" label={`${t.common.address} ${t.common.optional}`} defaultValue={address ?? ""} />
      <Field
        name="leaveNowThreshold"
        label={t.chamber.threshold}
        hint={t.chamber.thresholdHint}
        inputMode="numeric"
        defaultValue={String(threshold)}
        required
      />
    </>
  );
}
