/**
 * Report periods (pure). A week runs Saturday → Friday, as the work week does in
 * Bangladesh; a month is a Dhaka calendar month. Nothing reaches past today.
 */
import { addDays, dateOnly, weekdayOf } from "@/lib/format";

export type Period = "day" | "week" | "month";

export type PeriodRange = {
  period: Period;
  /** First and last day shown, "YYYY-MM-DD" (Dhaka), inclusive. */
  from: string;
  to: string;
  /** The anchor to put in links: a date (day/week) or "YYYY-MM" (month). */
  anchor: string;
  /** Anchors of the previous / next period (null when the next one is in the future). */
  prev: string;
  next: string | null;
};

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function isRealDate(ymd: string): boolean {
  return YMD.test(ymd) && dateOnly(ymd).toISOString().slice(0, 10) === ymd;
}

export function parsePeriod(value: unknown): Period {
  return value === "week" || value === "month" ? value : "day";
}

/** Saturday on or before `ymd`. */
export function weekStart(ymd: string): string {
  return addDays(ymd, -((weekdayOf(ymd) + 1) % 7));
}

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

function shiftMonth(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * The range for `period` around `anchor` (from the URL; anything invalid or in
 * the future falls back to today / this month).
 */
export function periodRange(period: Period, anchor: unknown, today: string): PeriodRange {
  const min = (a: string, b: string) => (a < b ? a : b);
  if (period === "month") {
    const thisMonth = today.slice(0, 7);
    const ym = typeof anchor === "string" && YM.test(anchor) && anchor <= thisMonth ? anchor : thisMonth;
    const nextYm = shiftMonth(ym, 1);
    return {
      period,
      from: `${ym}-01`,
      to: min(lastDayOfMonth(ym), today),
      anchor: ym,
      prev: shiftMonth(ym, -1),
      next: nextYm <= thisMonth ? nextYm : null,
    };
  }
  const date = typeof anchor === "string" && isRealDate(anchor) && anchor <= today ? anchor : today;
  if (period === "week") {
    const start = weekStart(date);
    const nextStart = addDays(start, 7);
    return {
      period,
      from: start,
      to: min(addDays(start, 6), today),
      anchor: start,
      prev: addDays(start, -7),
      next: nextStart <= today ? nextStart : null,
    };
  }
  const next = addDays(date, 1);
  return { period, from: date, to: date, anchor: date, prev: addDays(date, -1), next: next <= today ? next : null };
}
