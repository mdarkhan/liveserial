import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SmsCost } from "@/components/sms-cost";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { resolveFeatures } from "@/lib/features";
import { bn, dhakaDateString } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { getOrgSmsMonth } from "@/lib/reports";
import { appBaseUrl } from "@/lib/sms";
import { patientLink, renderSms, smsSegments, type SmsTemplateCode } from "@/lib/sms-text";

export const metadata: Metadata = { title: t.smsCost.title };

const TEMPLATES: SmsTemplateCode[] = ["TOKEN_CREATED", "LEAVE_NOW", "NEXT_UP", "DELAY_BROADCAST"];
const sc = t.smsCost;

/**
 * Clinic admin: how many billable parts each automatic SMS takes, per doctor,
 * plus this month's usage. Only where the super admin switched SMS_COST_PREVIEW on.
 */
export default async function AdminSmsCostPage() {
  const { user, orgId } = await requireOrgUser(["ORG_ADMIN"]);
  if (!resolveFeatures(user.organization?.features).SMS_COST_PREVIEW) notFound();

  const [doctors, month] = await Promise.all([
    prisma.doctor.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getOrgSmsMonth(orgId, dhakaDateString().slice(0, 7)),
  ]);
  // Real link length: this server's address + a 10-character code; a 3-digit serial.
  const link = patientLink(appBaseUrl(), "x".repeat(10));
  const sample = (code: SmsTemplateCode, doctorName: string) =>
    renderSms(code, { serial: 100, doctorName, link, peopleAhead: 5, minutes: 30 });

  return (
    <>
      <PageHeader title={sc.title} subtitle={sc.intro} />

      <Card className="mb-5" aria-labelledby="month-h">
        <h2 id="month-h" className="mb-3 text-lg font-semibold">
          {sc.thisMonth}
        </h2>
        <dl className="grid grid-cols-3 gap-2">
          {[
            [sc.segments, month.sentSegments],
            [sc.sent, month.sent],
            [sc.failed, month.failed],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-line bg-canvas px-3 py-2">
              <dt className="text-sm text-ink-muted">{label}</dt>
              <dd className="tabular text-lg font-bold">{bn(Number(value))}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <section aria-labelledby="per-doctor-h">
        <h2 id="per-doctor-h" className="text-lg font-semibold">
          {sc.perDoctor}
        </h2>
        <p className="mb-3 text-sm text-ink-muted">{sc.sampleNote}</p>
        {doctors.length === 0 ? (
          <EmptyState>{sc.noDoctors}</EmptyState>
        ) : (
          <div className="space-y-4">
            {doctors.map((d) => {
              const anyMulti = TEMPLATES.some((c) => smsSegments(sample(c, d.name)).segments > 1);
              return (
                <Card key={d.id} aria-label={d.name}>
                  <h3 className="mb-3 font-semibold">{d.name}</h3>
                  <ul className="space-y-3">
                    {TEMPLATES.map((code) => {
                      const text = sample(code, d.name);
                      return (
                        <li key={code}>
                          <p className="text-sm font-semibold text-ink-muted">{sc.templates[code]}</p>
                          <p className="mt-1 rounded-lg border border-line bg-surface px-3 py-2 break-words">{text}</p>
                          <SmsCost text={text} className="mt-1" />
                        </li>
                      );
                    })}
                  </ul>
                  {anyMulti && (
                    <p className="mt-3 text-sm text-ink-muted">
                      {sc.tipName} {sc.tipDomain}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
