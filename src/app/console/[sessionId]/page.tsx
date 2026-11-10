import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n/bn";
import { appBaseUrl } from "@/lib/sms";
import { getConsoleView } from "@/lib/snapshot";
import { ConsoleClient } from "./console-client";

export const metadata: Metadata = { title: t.nav.console };

export default async function ConsolePage({ params }: PageProps<"/console/[sessionId]">) {
  const { user, orgId } = await requireOrgUser(["ORG_ADMIN", "ASSISTANT", "DOCTOR"]);
  const { sessionId } = await params;

  if (user.role === "DOCTOR") {
    const own = await prisma.session.count({
      where: { id: sessionId, organizationId: orgId, doctor: { userId: user.id } },
    });
    if (!own) notFound();
  }
  const view = await getConsoleView(orgId, sessionId);
  if (!view) notFound();

  return <ConsoleClient initial={view} readOnly={user.role === "DOCTOR"} smsBaseUrl={appBaseUrl()} />;
}
