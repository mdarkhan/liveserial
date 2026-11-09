import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ActionForm, CheckboxField, Field, SubmitButton } from "@/components/form";
import { Badge, Card, CardTitle, EmptyState, LinkButton, List, ListItem, PageHeader } from "@/components/ui";
import { requireOrgUser } from "@/lib/access";
import { prisma } from "@/lib/db";
import { bn, displayPhone, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { sessionTone, tokenTone } from "@/lib/status";
import { addTokenAction, cancelSessionAction, cancelTokenAction, editTokenAction } from "../../actions";

export const metadata: Metadata = { title: t.session.title };

export default async function SessionPage({ params }: PageProps<"/admin/sessions/[id]">) {
  const { orgId } = await requireOrgUser(["ORG_ADMIN"]);
  const { id } = await params;
  const session = await prisma.session.findFirst({
    where: { id, organizationId: orgId },
    include: {
      doctor: true,
      chamber: true,
      tokens: { orderBy: { serial: "asc" } },
      events: {
        orderBy: { id: "desc" },
        take: 30,
        include: { actor: { select: { name: true } }, token: { select: { serial: true } } },
      },
    },
  });
  if (!session) notFound();

  const closed = session.status === "ENDED" || session.status === "CANCELLED";
  const editable = (s: string) => !closed && ["WAITING", "CALLED", "IN_CONSULT", "SKIPPED", "NO_SHOW"].includes(s);
  const cancellable = (s: string) => !closed && ["WAITING", "SKIPPED", "NO_SHOW"].includes(s);

  return (
    <>
      <PageHeader
        back={{ href: `/admin/sessions?date=${session.date.toISOString().slice(0, 10)}`, label: t.session.title }}
        title={session.doctor.name}
        subtitle={`${formatDate(session.scheduledStartAt)}, ${formatTime(session.scheduledStartAt)} · ${session.chamber.name}`}
        actions={
          <>
            <Badge tone={sessionTone(session.status)}>{t.sessionStatus[session.status]}</Badge>
            {!closed && (
              <LinkButton href={`/console/${session.id}`} variant="secondary">
                {t.session.openConsole}
              </LinkButton>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        {/* On phones the add form comes first, so it isn't below a long list. */}
        <div className="space-y-5 lg:col-start-2 lg:row-start-1">
          {closed ? (
            <Card>
              <p className="text-ink-muted">{t.token.sessionClosed}</p>
            </Card>
          ) : (
            <>
              <Card>
                <CardTitle>{t.token.quickAdd}</CardTitle>
                <ActionForm action={addTokenAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <input type="hidden" name="rid" value={randomUUID()} />
                  <Field name="name" label={t.token.patientName} required autoComplete="off" />
                  <Field
                    name="phone"
                    label={t.token.patientPhone}
                    hint={t.token.phoneOptional}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                  />
                  <CheckboxField name="isEmergency" label={t.token.emergency} />
                  <SubmitButton pendingLabel={t.common.saving} size="lg" className="w-full">
                    {t.token.quickAdd}
                  </SubmitButton>
                </ActionForm>
              </Card>
              <Card>
                <form action={cancelSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <input type="hidden" name="rid" value={randomUUID()} />
                  <SubmitButton
                    variant="danger"
                    className="w-full"
                    pendingLabel={t.common.saving}
                    confirm={t.session.cancelConfirm}
                  >
                    {t.session.cancel}
                  </SubmitButton>
                </form>
              </Card>
            </>
          )}
        </div>
        <div className="space-y-5 lg:col-start-1 lg:row-start-1">
          <section aria-labelledby="tokens-h">
            <h2 id="tokens-h" className="mb-2 text-lg font-semibold">
              {t.session.tokens} (<span className="tabular">{bn(session.tokens.length)}</span>)
            </h2>
            {session.tokens.length === 0 ? (
              <EmptyState>{t.session.noTokens}</EmptyState>
            ) : (
              <List>
                {session.tokens.map((tk) => (
                  <ListItem key={tk.id}>
                    <span className="tabular w-12 text-2xl font-bold text-primary" aria-label={t.token.serial}>
                      {bn(tk.serial)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {tk.patientName} {tk.isEmergency && <Badge tone="danger">{t.token.emergency}</Badge>}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {tk.patientPhone ? bn(displayPhone(tk.patientPhone)) : t.common.none} · {t.token.link}:{" "}
                        <a href={`/t/${tk.publicCode}`} className="font-mono text-primary underline">
                          /t/{tk.publicCode}
                        </a>
                      </p>
                    </div>
                    <Badge tone={tokenTone(tk.status)}>{t.tokenStatus[tk.status]}</Badge>
                    {editable(tk.status) && (
                      <details className="w-full">
                        <summary className="inline-flex min-h-12 items-center font-medium text-primary">
                          {t.token.edit}
                        </summary>
                        <div className="mt-2 space-y-3">
                          <ActionForm action={editTokenAction} resetOnSuccess={false}>
                            <input type="hidden" name="sessionId" value={session.id} />
                            <input type="hidden" name="tokenId" value={tk.id} />
                            <input type="hidden" name="rid" value={randomUUID()} />
                            <Field name="name" label={t.token.patientName} defaultValue={tk.patientName} required />
                            <Field
                              name="phone"
                              label={t.token.patientPhone}
                              type="tel"
                              inputMode="tel"
                              defaultValue={tk.patientPhone ? displayPhone(tk.patientPhone) : ""}
                            />
                            <CheckboxField name="isEmergency" label={t.token.emergency} defaultChecked={tk.isEmergency} />
                            <SubmitButton pendingLabel={t.common.saving}>{t.common.save}</SubmitButton>
                          </ActionForm>
                          {cancellable(tk.status) && (
                            <form action={cancelTokenAction}>
                              <input type="hidden" name="sessionId" value={session.id} />
                              <input type="hidden" name="tokenId" value={tk.id} />
                              <input type="hidden" name="rid" value={randomUUID()} />
                              <SubmitButton variant="danger" pendingLabel={t.common.saving} confirm={t.token.cancelConfirm}>
                                {t.token.cancelToken}
                              </SubmitButton>
                            </form>
                          )}
                        </div>
                      </details>
                    )}
                  </ListItem>
                ))}
              </List>
            )}
          </section>

          <section aria-labelledby="audit-h">
            <h2 id="audit-h" className="mb-2 text-lg font-semibold">
              {t.audit.title}
            </h2>
            {session.events.length === 0 ? (
              <EmptyState>{t.audit.empty}</EmptyState>
            ) : (
              <List>
                {session.events.map((e) => {
                  const meta = (e.meta ?? {}) as { jumpedSerials?: number[]; minutes?: number; auto?: boolean };
                  return (
                    <ListItem
                      key={String(e.id)}
                      className={e.isOutOfOrder ? "border-l-4 border-warning bg-warning-soft text-sm" : "text-sm"}
                    >
                      <span className="w-full text-ink-muted">
                        <span className="tabular">{formatTime(e.createdAt)}</span> · {e.actor?.name ?? t.audit.system}
                      </span>
                      <span className="-mt-2 min-w-0 flex-1">
                        <span className={e.isOutOfOrder ? "font-bold text-warning-ink" : "font-medium"}>
                          {e.isOutOfOrder && <span aria-hidden="true">⚠ </span>}
                          {t.audit.actions[e.action]}
                        </span>
                        {e.token && <> · {t.token.serial} {bn(e.token.serial)}</>}
                        {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && (
                          <span className="text-ink-muted">
                            {" "}
                            ({statusLabel(e.fromStatus)} → {statusLabel(e.toStatus)})
                          </span>
                        )}
                        {meta.auto && <span className="text-ink-muted"> · {t.audit.auto}</span>}
                        {e.action === "DELAY_SET" && meta.minutes !== undefined && (
                          <span> · {meta.minutes ? t.console.delayMinutes(bn(meta.minutes)) : t.console.delayNone}</span>
                        )}
                        {e.isOutOfOrder && (
                          <span className="mt-1 block text-warning-ink">
                            {t.audit.reason}: {e.reason ? t.console.reasons[e.reason] : t.common.none}
                            {e.note && <> — “{e.note}”</>}
                            {meta.jumpedSerials?.length ? (
                              <> · {t.audit.jumped}: {meta.jumpedSerials.map((n) => bn(n)).join(", ")}</>
                            ) : null}
                          </span>
                        )}
                      </span>
                    </ListItem>
                  );
                })}
              </List>
            )}
          </section>
        </div>

      </div>
    </>
  );
}

function statusLabel(s: string): string {
  return (t.tokenStatus as Record<string, string>)[s] ?? (t.sessionStatus as Record<string, string>)[s] ?? s;
}
