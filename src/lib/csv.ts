/**
 * CSV export of reports. UTF-8 with a byte-order mark and CRLF line ends, so
 * Excel opens Bangla text correctly; plain ASCII digits so spreadsheets can sum
 * the numbers. Pure (unit-tested).
 */
import { DHAKA_TZ } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { RangeReport } from "@/lib/reports";

/**
 * One cell. Quotes when needed; a value starting with = + - @ (or a tab / CR)
 * gets a leading apostrophe so a spreadsheet never runs it as a formula
 * (names and notes are typed by people).
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: DHAKA_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** "17:30" in Dhaka. */
export function dhakaHHmm(at: Date): string {
  return timeFmt.format(at);
}

/** "2026-11-10" in Dhaka. */
export function dhakaYmd(at: Date): string {
  return dateFmt.format(at);
}

const c = t.report.csv;

/** One row per sitting. */
export function sessionsCsv(report: RangeReport): string {
  return toCsv([
    [c.date, c.time, c.doctor, c.chamber, c.status, c.booked, c.served, c.noShow, c.avgWait, c.avgConsult, c.late, c.outOfOrder],
    ...report.sessions.map((s) => [
      s.date,
      dhakaHHmm(s.scheduledStartAt),
      s.doctorName,
      s.chamberName,
      t.sessionStatus[s.status],
      s.summary.booked,
      s.summary.served,
      s.summary.noShow,
      s.summary.avgWait,
      s.summary.avgConsult,
      s.summary.late === null ? null : Math.max(0, s.summary.late),
      s.outOfOrder,
    ]),
  ]);
}

/** One row per out-of-order call, with its reason. */
export function outOfOrderCsv(report: RangeReport): string {
  return toCsv([
    [c.date, c.time, c.doctor, c.serial, c.patient, c.reason, c.note, c.jumped, c.calledBy],
    ...report.outOfOrder.map((e) => [
      dhakaYmd(e.at),
      dhakaHHmm(e.at),
      e.doctorName,
      e.serial,
      e.patientName,
      e.reason ? t.console.reasons[e.reason] : null,
      e.note,
      e.jumpedSerials.join(" "),
      e.actorName ?? t.audit.system,
    ]),
  ]);
}
