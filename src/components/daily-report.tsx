import Link from "next/link";
import { Badge, buttonClass, Card, EmptyState, List, ListItem } from "@/components/ui";
import { bn, formatDateShort, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { DailyReport, OutOfOrderRow } from "@/lib/reports";
import { sessionTone } from "@/lib/status";

const r = t.report;

export function mins(m: number | null): string {
  return m === null ? r.noData : r.minutes(bn(m));
}

function late(m: number | null): string {
  if (m === null) return r.notArrived;
  // The report is about lateness: arriving early (even hours early, e.g. a test tap) is "on time".
  return m <= 0 ? r.onTime : r.minutes(bn(m));
}

export function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className={warn ? "tabular text-lg font-bold text-warning-ink" : "tabular text-lg font-bold"}>{value}</dd>
    </div>
  );
}

/** Date picker (GET form) for a report page. */
export function ReportDateForm({ date, max }: { date: string; max: string }) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
      <label className="flex-1 sm:flex-none">
        <span className="mb-1 block font-medium">{t.common.date}</span>
        <input
          type="date"
          name="date"
          defaultValue={date}
          max={max}
          className="block min-h-12 w-full rounded-lg border-2 border-line-strong bg-surface px-3"
        />
      </label>
      <button type="submit" className={buttonClass("secondary")}>
        {t.session.showDate}
      </button>
    </form>
  );
}

/** One day's report. `sessionHref` links each sitting to its detail page (admins only). */
export function DailyReportView({
  report,
  sessionHref,
}: {
  report: DailyReport;
  sessionHref?: (id: string) => string;
}) {
  if (report.sessions.length === 0) return <EmptyState>{r.empty}</EmptyState>;
  const d = report.totals;

  return (
    <div className="space-y-5">
      {report.sessions.length > 1 && (
        <Card aria-labelledby="day-total-h">
          <h2 id="day-total-h" className="mb-3 text-lg font-semibold">
            {r.dayTotal}
          </h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label={r.served} value={`${bn(d.served)} / ${bn(d.booked)}`} />
            <Stat label={r.avgWait} value={mins(d.avgWait)} />
            <Stat label={r.avgConsult} value={mins(d.avgConsult)} />
            <Stat label={r.avgLate} value={mins(d.avgLate)} />
            <Stat label={r.noShow} value={bn(d.noShow)} />
            <Stat label={r.outOfOrder} value={bn(report.outOfOrder.length)} warn={report.outOfOrder.length > 0} />
          </dl>
        </Card>
      )}

      {report.sessions.map((s) => (
        <Card key={s.id} aria-label={`${s.doctorName}, ${formatTime(s.scheduledStartAt)}`}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">
                {sessionHref ? (
                  <Link href={sessionHref(s.id)} className="text-primary underline-offset-2 hover:underline">
                    {s.doctorName}
                  </Link>
                ) : (
                  s.doctorName
                )}
              </h2>
              <p className="text-sm text-ink-muted">
                {formatTime(s.scheduledStartAt)} · {s.chamberName}
              </p>
            </div>
            <Badge tone={sessionTone(s.status)}>{t.sessionStatus[s.status]}</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label={r.served} value={`${bn(s.summary.served)} / ${bn(s.summary.booked)}`} />
            <Stat label={r.avgWait} value={mins(s.summary.avgWait)} />
            <Stat label={r.avgConsult} value={mins(s.summary.avgConsult)} />
            <Stat label={r.late} value={late(s.summary.late)} warn={(s.summary.late ?? 0) > 0} />
            <Stat label={r.noShow} value={bn(s.summary.noShow)} />
            <Stat label={r.outOfOrder} value={bn(s.outOfOrder)} warn={s.outOfOrder > 0} />
          </dl>
        </Card>
      ))}

      <section aria-labelledby="ooo-h">
        <h2 id="ooo-h" className="mb-2 text-lg font-semibold">
          {r.outOfOrderTitle}
        </h2>
        <OutOfOrderList items={report.outOfOrder} empty={r.outOfOrderNone} />
      </section>

      <p className="text-sm text-ink-muted">{r.waitNote}</p>
    </div>
  );
}

/** Out-of-order calls with reason, note, who was jumped, time, doctor and caller. */
export function OutOfOrderList({
  items,
  empty,
  showDate,
}: {
  items: OutOfOrderRow[];
  empty: string;
  showDate?: boolean;
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <List>
      {items.map((e) => (
        <ListItem key={e.id} className="border-l-4 border-warning bg-warning-soft">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-warning-ink">
              <span aria-hidden="true">⚠ </span>
              {t.token.serial} {e.serial === null ? r.noData : bn(e.serial)}
              {e.patientName && <span className="font-medium"> · {e.patientName}</span>}
            </p>
            <p>
              {t.audit.reason}: <strong>{e.reason ? t.console.reasons[e.reason] : t.common.none}</strong>
              {e.note && <> — “{e.note}”</>}
            </p>
            {e.jumpedSerials.length > 0 && (
              <p className="text-sm">
                {t.audit.jumped}: {e.jumpedSerials.map((n) => bn(n)).join(", ")}
              </p>
            )}
            <p className="text-sm text-ink-muted">
              <span className="tabular">
                {showDate && <>{formatDateShort(e.at)} · </>}
                {formatTime(e.at)}
              </span>{" "}
              · {e.doctorName} · {r.calledBy}: {e.actorName ?? t.audit.system}
            </p>
          </div>
        </ListItem>
      ))}
    </List>
  );
}
