import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Badge, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { bn, dateOnly, dhakaDateString, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { sessionTone } from "@/lib/status";

export const metadata: Metadata = { title: t.console.title };

/** Phase 1: today's sessions (read-only). The live console arrives in Phase 2. */
export default async function ConsoleHome() {
  const { user, orgId } = await requireOrgUser(["ORG_ADMIN", "ASSISTANT", "DOCTOR"]);
  const today = dhakaDateString();
  const sessions = await prisma.session.findMany({
    where: {
      organizationId: orgId,
      date: dateOnly(today),
      ...(user.role === "DOCTOR" ? { doctorId: user.doctor?.id ?? "-" } : {}),
    },
    orderBy: { scheduledStartAt: "asc" },
    include: {
      doctor: { select: { name: true } },
      chamber: { select: { name: true } },
      _count: { select: { tokens: { where: { status: { not: "CANCELLED" } } } } },
    },
  });

  return (
    <AppShell user={user}>
      <PageHeader title={t.console.title} subtitle={formatDate(dateOnly(today))} />
      <p className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-warning-ink">
        {t.console.comingSoon}
      </p>
      {sessions.length === 0 ? (
        <EmptyState>{t.session.empty}</EmptyState>
      ) : (
        <List>
          {sessions.map((s) => (
            <ListItem key={s.id}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{s.doctor.name}</p>
                <p className="text-sm text-ink-muted">
                  {formatTime(s.scheduledStartAt)} · {s.chamber.name} · {t.session.patients}: {bn(s._count.tokens)}
                </p>
              </div>
              <Badge tone={sessionTone(s.status)}>{t.sessionStatus[s.status]}</Badge>
            </ListItem>
          ))}
        </List>
      )}
    </AppShell>
  );
}
