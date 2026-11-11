import Link from "next/link";
import { mins, OutOfOrderList, Stat } from "@/components/daily-report";
import { buttonClass, Card, cx, EmptyState } from "@/components/ui";
import { bn, dateOnly, formatDateShort } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { Period, PeriodRange } from "@/lib/report-period";
import type { RangeDay, RangeReport } from "@/lib/reports";

const r = t.report;
const PERIODS: Period[] = ["day", "week", "month"];

const monthFmt = new Intl.DateTimeFormat("bn-BD", { month: "long", year: "numeric", timeZone: "UTC" });
const dayMonthFmt = new Intl.DateTimeFormat("bn-BD", { day: "numeric", month: "short", timeZone: "UTC" });

/** "৮–১৪ নভে" for a week, "নভেম্বর ২০২৬" for a month, the long date for a day. */
export function periodLabel(range: PeriodRange): string {
  if (range.period === "month") return monthFmt.format(dateOnly(range.from));
  if (range.period === "week") {
    return `${dayMonthFmt.format(dateOnly(range.from))} – ${formatDateShort(dateOnly(range.to))}`;
  }
  return formatDateShort(dateOnly(range.from));
}

function href(base: string, period: Period, anchor: string) {
  return `${base}?period=${period}&date=${anchor}`;
}

/**
 * Day / week / month tabs, previous / next, and a date (or month) picker.
 * Plain links and a GET form: works without JavaScript.
 */
export function ReportPeriodNav({ base, range, today }: { base: string; range: PeriodRange; today: string }) {
  return (
    <div className="mb-4 space-y-3">
      <nav aria-label={r.periodLabel} className="grid grid-cols-3 gap-1 rounded-lg bg-canvas p-1 sm:inline-grid">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={href(base, p, p === "month" ? range.from.slice(0, 7) : range.from)}
            aria-current={p === range.period ? "page" : undefined}
            className={cx(
              "inline-flex min-h-12 items-center justify-center rounded-md px-4 font-semibold",
              p === range.period ? "bg-surface text-primary shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {r.periods[p]}
          </Link>
        ))}
      </nav>

      <form method="get" action={base} className="flex items-end gap-2">
        <input type="hidden" name="period" value={range.period} />
        <label className="min-w-0 flex-1 sm:max-w-xs">
          <span className="mb-1 block font-medium">{range.period === "month" ? r.monthField : t.common.date}</span>
          <input
            type={range.period === "month" ? "month" : "date"}
            name="date"
            defaultValue={range.period === "month" ? range.anchor : range.from}
            max={range.period === "month" ? today.slice(0, 7) : today}
            className="block min-h-12 w-full rounded-lg border-2 border-line-strong bg-surface px-3"
          />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          {r.show}
        </button>
      </form>

      <div className="flex items-center justify-between gap-2 sm:justify-start">
        <Link href={href(base, range.period, range.prev)} className={buttonClass("secondary")}>
          <span aria-hidden="true">‹</span> {r.prev}
        </Link>
        {range.next ? (
          <Link href={href(base, range.period, range.next)} className={buttonClass("secondary")}>
            {r.next} <span aria-hidden="true">›</span>
          </Link>
        ) : (
          <span className={buttonClass("secondary", "md", "pointer-events-none opacity-40")} aria-disabled="true">
            {r.next} <span aria-hidden="true">›</span>
          </span>
        )}
      </div>
      {range.period === "week" && <p className="text-sm text-ink-muted">{r.weekHint}</p>}
    </div>
  );
}

/** Download links for the period's CSV files. */
export function CsvLinks({ csvHref }: { csvHref: (kind: "sessions" | "out-of-order") => string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold">{r.download}:</span>
      <a href={csvHref("sessions")} download className={buttonClass("secondary")}>
        {r.csvSessions}
      </a>
      <a href={csvHref("out-of-order")} download className={buttonClass("secondary")}>
        {r.csvOoo}
      </a>
      <span className="w-full text-sm text-ink-muted">{r.csvHint}</span>
    </div>
  );
}

/**
 * One value per day as bars (single series, so no legend: the title names it).
 * Each bar has a full-height hover target with a tooltip; the table below the
 * charts is the accessible data view.
 */
function DayBars({ title, days, value, format }: { title: string; days: RangeDay[]; value: (d: RangeDay) => number | null; format: (v: number) => string }) {
  const values = days.map(value);
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const n = days.length;
  // A fixed drawing width, so the chart keeps the same shape for 1 day or 31.
  const width = 320;
  const slot = width / Math.max(n, 1);
  const gap = 2;
  const barWidth = Math.min(slot - gap, 28);
  const height = 120;
  const labelEvery = n <= 7 ? 1 : n <= 16 ? 2 : 5;
  const peak = max > 0 ? values.indexOf(max) : -1;

  return (
    <figure className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <figcaption className="mb-2 font-semibold">{title}</figcaption>
      {max === 0 ? (
        <p className="py-6 text-center text-ink-muted">{r.chartNone}</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height + 34}`}
          className="block h-auto w-full"
          role="img"
          aria-label={`${title}: ${days
            .map((d, i) => (values[i] !== null ? r.chartBar(dayMonthFmt.format(dateOnly(d.date)), format(values[i]!)) : null))
            .filter(Boolean)
            .join(", ")}`}
        >
          {/* baseline */}
          <line x1="0" x2={width} y1={height + 14} y2={height + 14} stroke="var(--color-line)" strokeWidth="1" />
          {days.map((d, i) => {
            const v = values[i];
            const h = v && max ? Math.max(2, (v / max) * height) : 0;
            const w = barWidth;
            const x = i * slot + (slot - w) / 2;
            const y = height + 14 - h;
            const rad = Math.min(4, h / 2, w / 2);
            const day = Number(d.date.slice(8));
            return (
              <g key={d.date}>
                <title>{r.chartBar(dayMonthFmt.format(dateOnly(d.date)), v === null ? r.noData : format(v))}</title>
                {/* hover target: the whole column */}
                <rect x={i * slot} y="0" width={slot} height={height + 34} fill="transparent" />
                {h > 0 && (
                  <path
                    d={`M${x},${y + h} V${y + rad} Q${x},${y} ${x + rad},${y} H${x + w - rad} Q${x + w},${y} ${x + w},${y + rad} V${y + h} Z`}
                    fill="var(--color-primary)"
                  />
                )}
                {i === peak && (
                  <text x={x + w / 2} y={y - 3} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-ink)">
                    {format(v!)}
                  </text>
                )}
                {(i % labelEvery === 0 || i === n - 1) && (
                  <text x={x + w / 2} y={height + 30} textAnchor="middle" fontSize="12" fill="var(--color-ink-muted)">
                    {bn(day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </figure>
  );
}

/** A week or month: totals, two daily charts, a per-day table, per-doctor totals and out-of-order calls. */
export function RangeReportView({ report, showDoctors }: { report: RangeReport; showDoctors: boolean }) {
  if (report.sessions.length === 0) return <EmptyState>{r.rangeEmpty}</EmptyState>;
  const d = report.totals;
  const daysWithSessions = report.days.filter((x) => x.sessions > 0);

  return (
    <div className="space-y-5">
      <Card aria-labelledby="range-total-h">
        <h2 id="range-total-h" className="mb-3 text-lg font-semibold">
          {r.total}
        </h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={r.served} value={`${bn(d.served)} / ${bn(d.booked)}`} />
          <Stat label={r.sessions} value={bn(report.sessions.length)} />
          <Stat label={r.avgWait} value={mins(d.avgWait)} />
          <Stat label={r.avgConsult} value={mins(d.avgConsult)} />
          <Stat label={r.avgLate} value={mins(d.avgLate)} />
          <Stat label={r.noShow} value={bn(d.noShow)} />
          <Stat label={r.outOfOrder} value={bn(report.outOfOrder.length)} warn={report.outOfOrder.length > 0} />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <DayBars title={r.chartServed} days={report.days} value={(x) => (x.sessions ? x.served : null)} format={(v) => bn(v)} />
        <DayBars title={r.chartWait} days={report.days} value={(x) => x.avgWait} format={(v) => bn(v)} />
      </div>

      <section aria-labelledby="per-day-h">
        <h2 id="per-day-h" className="mb-2 text-lg font-semibold">
          {r.perDay}
        </h2>
        <table className="w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface text-sm">
          <thead className="bg-canvas text-left text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">
                {r.colDate}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                {r.colServed}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                {r.colWait}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {r.colOoo}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {daysWithSessions.map((x) => (
              <tr key={x.date}>
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {dayMonthFmt.format(dateOnly(x.date))}
                </th>
                <td className="tabular px-2 py-2 text-right">
                  {bn(x.served)} / {bn(x.booked)}
                </td>
                <td className="tabular px-2 py-2 text-right">{mins(x.avgWait)}</td>
                <td className={cx("tabular px-3 py-2 text-right", x.outOfOrder > 0 && "font-bold text-warning-ink")}>
                  {bn(x.outOfOrder)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showDoctors && report.doctors.length > 0 && (
        <section aria-labelledby="per-doctor-h">
          <h2 id="per-doctor-h" className="mb-2 text-lg font-semibold">
            {r.perDoctor}
          </h2>
          <div className="space-y-3">
            {report.doctors.map((doc) => (
              <Card key={doc.doctorId} aria-label={doc.doctorName}>
                <h3 className="mb-2 font-semibold">{doc.doctorName}</h3>
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label={r.served} value={`${bn(doc.served)} / ${bn(doc.booked)}`} />
                  <Stat label={r.sessions} value={bn(doc.sessions)} />
                  <Stat label={r.avgWait} value={mins(doc.avgWait)} />
                  <Stat label={r.avgConsult} value={mins(doc.avgConsult)} />
                  <Stat label={r.avgLate} value={mins(doc.avgLate)} />
                  <Stat label={r.noShow} value={bn(doc.noShow)} />
                  <Stat label={r.outOfOrder} value={bn(doc.outOfOrder)} warn={doc.outOfOrder > 0} />
                </dl>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="range-ooo-h">
        <h2 id="range-ooo-h" className="mb-2 text-lg font-semibold">
          {r.outOfOrderTitle}
        </h2>
        <OutOfOrderList items={report.outOfOrder} empty={r.oooNoneRange} showDate />
      </section>

      <p className="text-sm text-ink-muted">{r.waitNote}</p>
    </div>
  );
}
