import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ActionForm, Field, PasswordField, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { FEATURES, resolveFeatures } from "@/lib/features";
import { bn, formatDateShort } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { createOrganization, toggleOrganization } from "./actions";
import { superNav } from "./super-nav";

export const metadata: Metadata = { title: t.org.title };

export default async function SuperPage() {
  const user = await requireUser(["SUPER_ADMIN"]);
  const orgs = await prisma.organization.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { users: true, doctors: true } } },
  });

  return (
    <AppShell user={user} nav={superNav}>
      <PageHeader title={t.org.title} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div>
          {orgs.length === 0 ? (
            <EmptyState>{t.org.empty}</EmptyState>
          ) : (
            <List>
              {orgs.map((o) => (
                <ListItem key={o.id}>
                  {/* Full width on phones, so the buttons wrap to their own row. */}
                  <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <Link href={`/super/orgs/${o.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                      {o.name}
                    </Link>
                    <p className="text-sm text-ink-muted">
                      <span className="font-mono">{o.slug}</span> · {t.org.users}: {bn(o._count.users)} · {t.org.doctors}:{" "}
                      {bn(o._count.doctors)} · {formatDateShort(o.createdAt)}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {t.org.featuresOn(
                        bn(Object.values(resolveFeatures(o.features)).filter(Boolean).length),
                        bn(FEATURES.length),
                      )}
                    </p>
                  </div>
                  <Badge tone={o.isActive ? "success" : "neutral"}>{o.isActive ? t.common.active : t.common.inactive}</Badge>
                  <Link href={`/super/orgs/${o.id}`} className="inline-flex min-h-12 items-center px-2 font-medium text-primary underline">
                    {t.org.features}
                  </Link>
                  <form action={toggleOrganization}>
                    <input type="hidden" name="id" value={o.id} />
                    <button type="submit" className="min-h-12 px-2 font-medium text-primary underline">
                      {o.isActive ? t.common.deactivate : t.common.activate}
                    </button>
                  </form>
                </ListItem>
              ))}
            </List>
          )}
        </div>
        <Card>
          <CardTitle>{t.org.create}</CardTitle>
          <ActionForm action={createOrganization}>
            <Field name="orgName" label={t.org.name} required autoComplete="off" />
            <Field name="slug" label={t.org.slug} hint={t.org.slugHint} required autoComplete="off" lang="en" />
            <fieldset className="space-y-4 rounded-lg border border-line p-3">
              <legend className="px-1 font-semibold">{t.org.firstAdmin}</legend>
              <Field name="adminName" label={t.common.name} required autoComplete="off" />
              <Field
                name="phone"
                label={t.common.phone}
                hint={t.auth.phoneHint}
                type="tel"
                inputMode="tel"
                required
                autoComplete="off"
              />
              <PasswordField
                name="password"
                label={t.user.password}
                hint={t.user.passwordHint}
                showLabel={t.auth.showPassword}
                autoComplete="new-password"
                required
              />
            </fieldset>
            <SubmitButton pendingLabel={t.common.saving} className="w-full">
              {t.org.create}
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </AppShell>
  );
}
