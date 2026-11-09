import type { Metadata } from "next";
import { ActionForm, Field, PasswordField, SelectField, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { bn, displayPhone } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { createUser, resetUserPassword, toggleUser } from "../actions";

export const metadata: Metadata = { title: t.user.title };

const ROLES = ["ASSISTANT", "DOCTOR", "ORG_ADMIN"] as const;

export default async function UsersPage() {
  const { orgId, user: me } = await requireOrgUser(["ORG_ADMIN"]);
  const [users, freeDoctors] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: orgId },
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
      include: { doctor: { select: { name: true } } },
    }),
    prisma.doctor.findMany({
      where: { organizationId: orgId, userId: null, isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader title={t.user.title} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div>
          {users.length === 0 ? (
            <EmptyState>{t.user.empty}</EmptyState>
          ) : (
            <List>
              {users.map((u) => (
                <ListItem key={u.id}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{u.name}</p>
                    <p className="text-sm text-ink-muted">
                      {t.roles[u.role]}
                      {u.doctor ? ` (${u.doctor.name})` : ""} · {bn(displayPhone(u.phoneNumber))}
                    </p>
                  </div>
                  <Badge tone={u.isActive ? "success" : "neutral"}>
                    {u.isActive ? t.common.active : t.common.inactive}
                  </Badge>
                  <details className="w-full">
                    <summary className="inline-flex min-h-12 items-center font-medium text-primary">
                      {t.user.resetPassword}
                    </summary>
                    <div className="mt-2 space-y-3">
                      <ActionForm action={resetUserPassword}>
                        <input type="hidden" name="id" value={u.id} />
                        <PasswordField
                          name="password"
                          label={t.user.newPassword}
                          hint={t.user.passwordHint}
                          showLabel={t.auth.showPassword}
                          autoComplete="new-password"
                          required
                        />
                        <SubmitButton pendingLabel={t.common.saving}>{t.common.save}</SubmitButton>
                      </ActionForm>
                      {u.id !== me.id && (
                        <form action={toggleUser}>
                          <input type="hidden" name="id" value={u.id} />
                          <button type="submit" className="min-h-12 font-medium text-ink-muted underline">
                            {u.isActive ? t.common.deactivate : t.common.activate}
                          </button>
                        </form>
                      )}
                    </div>
                  </details>
                </ListItem>
              ))}
            </List>
          )}
        </div>
        <Card>
          <CardTitle>{t.user.add}</CardTitle>
          <ActionForm action={createUser}>
            <Field name="name" label={t.common.name} required autoComplete="off" />
            <Field
              name="phone"
              label={t.common.phone}
              hint={t.auth.phoneHint}
              type="tel"
              inputMode="tel"
              required
              autoComplete="off"
            />
            <SelectField
              name="role"
              label={t.user.role}
              required
              defaultValue="ASSISTANT"
              options={ROLES.map((r) => ({ value: r, label: t.roles[r] }))}
            />
            {freeDoctors.length > 0 && (
              <SelectField
                name="doctorId"
                label={`${t.user.linkDoctor} ${t.common.optional}`}
                options={[
                  { value: "", label: t.common.none },
                  ...freeDoctors.map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            )}
            <PasswordField
              name="password"
              label={t.user.password}
              hint={t.user.passwordHint}
              showLabel={t.auth.showPassword}
              autoComplete="new-password"
              required
            />
            <SubmitButton pendingLabel={t.common.saving} className="w-full">
              {t.common.add}
            </SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
