import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { DOCTOR_FEATURES, FEATURE_GROUPS, FEATURES, ORG_ONLY, parseOverrides, resolveFeatures } from "@/lib/features";
import { bn } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { saveDoctorFeatures, saveOrgFeatures } from "../../actions";
import { superNav } from "../../super-nav";

const f = t.features;

export const metadata: Metadata = { title: t.org.features };

/** Super admin: which optional features are on for this organization, and per doctor. */
export default async function OrgFeaturesPage({ params }: PageProps<"/super/orgs/[id]">) {
  const user = await requireUser(["SUPER_ADMIN"]);
  const { id } = await params;
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      doctors: {
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        select: { id: true, name: true, specialty: true, isActive: true, features: true },
      },
    },
  });
  if (!org) notFound();
  const orgFlags = resolveFeatures(org.features);

  return (
    <AppShell user={user} nav={superNav}>
      <PageHeader title={f.title(org.name)} subtitle={f.intro} back={{ href: "/super", label: t.org.title }} />

      <div className="space-y-5">
        <Card aria-labelledby="org-features-h">
          <h2 id="org-features-h" className="text-lg font-semibold">
            {f.orgTitle}
          </h2>
          <p className="mb-4 text-sm text-ink-muted">{f.orgHint}</p>
          <ActionForm action={saveOrgFeatures} resetOnSuccess={false}>
            <input type="hidden" name="orgId" value={org.id} />
            {FEATURE_GROUPS.map((g) => (
              <fieldset key={g.key} className="space-y-1 rounded-lg border border-line p-3">
                <legend className="px-1 font-semibold">{f.groups[g.key]}</legend>
                {g.features.map((key) => (
                  <label key={key} className="flex min-h-12 items-start gap-3 rounded-lg px-1 py-2 hover:bg-canvas">
                    <input
                      type="checkbox"
                      name={key}
                      defaultChecked={orgFlags[key]}
                      className="mt-0.5 size-6 shrink-0 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{f.names[key]}</span>
                      <span className="block text-sm text-ink-muted">
                        {f.hints[key]}
                        {ORG_ONLY.includes(key) && <> · {f.orgOnly}</>}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingLabel={t.common.saving} className="flex-1 sm:flex-none">
                {f.saveOrg}
              </SubmitButton>
              <button type="submit" name="preset" value="all-on" className={buttonClass("secondary")}>
                {f.allOn}
              </button>
              <button type="submit" name="preset" value="all-off" className={buttonClass("ghost")}>
                {f.allOff}
              </button>
            </div>
          </ActionForm>
        </Card>

        <section aria-labelledby="doctor-features-h">
          <h2 id="doctor-features-h" className="text-lg font-semibold">
            {f.doctorsTitle}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">{f.doctorsHint}</p>
          {org.doctors.length === 0 ? (
            <EmptyState>{f.noDoctors}</EmptyState>
          ) : (
            <div className="space-y-3">
              {org.doctors.map((d) => {
                const overrides = parseOverrides(d.features);
                const count = Object.keys(overrides).length;
                return (
                  <details key={d.id} className="group rounded-[var(--radius-card)] border border-line bg-surface">
                    <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                      <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90">
                        ›
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{d.name}</span>
                        {d.specialty && <span className="block text-sm text-ink-muted">{d.specialty}</span>}
                      </span>
                      {!d.isActive && <Badge>{t.common.inactive}</Badge>}
                      <Badge tone={count > 0 ? "primary" : "neutral"}>{f.overrides(bn(count))}</Badge>
                    </summary>
                    <div className="border-t border-line p-4">
                      <ActionForm action={saveDoctorFeatures} resetOnSuccess={false}>
                        <input type="hidden" name="orgId" value={org.id} />
                        <input type="hidden" name="doctorId" value={d.id} />
                        {FEATURE_GROUPS.map((g) => {
                          const keys = g.features.filter((k) => DOCTOR_FEATURES.includes(k));
                          if (keys.length === 0) return null;
                          return (
                            <fieldset key={g.key} className="space-y-3">
                              <legend className="mb-1 font-semibold text-ink-muted">{f.groups[g.key]}</legend>
                              {keys.map((key) => {
                                const value = overrides[key] === true ? "on" : overrides[key] === false ? "off" : "inherit";
                                return (
                                  <label key={key} className="block">
                                    <span className="mb-1 block font-medium">{f.names[key]}</span>
                                    <select
                                      name={key}
                                      defaultValue={value}
                                      className="block min-h-12 w-full rounded-lg border-2 border-line-strong bg-surface px-3"
                                    >
                                      <option value="inherit">{f.inherit(orgFlags[key] ? f.on : f.off)}</option>
                                      <option value="on">{f.on}</option>
                                      <option value="off">{f.off}</option>
                                    </select>
                                  </label>
                                );
                              })}
                            </fieldset>
                          );
                        })}
                        <SubmitButton pendingLabel={t.common.saving} className="w-full sm:w-auto">
                          {f.saveDoctor}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

// Keeps the list in sync if a feature is added without a group.
const grouped = new Set(FEATURE_GROUPS.flatMap((g) => g.features));
if (FEATURES.some((k) => !grouped.has(k))) throw new Error("Every feature must belong to a FEATURE_GROUPS entry");
