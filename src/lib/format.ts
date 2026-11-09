/**
 * Formatting helpers: Bangla digits, Asia/Dhaka time, Bangladeshi phone numbers.
 * Bangladesh has had no DST since 2009, so Dhaka is always UTC+06:00.
 */

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
export const DHAKA_TZ = "Asia/Dhaka";
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** 12 → "১২". Works on any string/number; leaves non-digits alone. */
export function bn(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** "০১৭১১" → "01711". Accepts Bangla or English digits in user input. */
export function toAsciiDigits(value: string): string {
  return value.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/**
 * Normalizes a Bangladeshi mobile number to 8801XXXXXXXXX (13 digits).
 * Accepts 01XXXXXXXXX, +8801…, 8801…, with spaces/dashes and Bangla digits.
 * Returns null when it isn't a valid BD mobile number.
 */
export function normalizeBdPhone(input: string): string | null {
  const digits = toAsciiDigits(input).replace(/[\s\-().]/g, "").replace(/^\+/, "");
  let local: string;
  if (/^8801[3-9]\d{8}$/.test(digits)) local = digits.slice(2);
  else if (/^01[3-9]\d{8}$/.test(digits)) local = digits;
  else return null;
  return `88${local}`;
}

/** 8801711000000 → "01711-000000" (for display to staff). */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const local = phone.startsWith("88") ? phone.slice(2) : phone;
  return `${local.slice(0, 5)}-${local.slice(5)}`;
}

// ───────────── Dhaka dates ─────────────

/** Today's calendar date in Dhaka as "YYYY-MM-DD". */
export function dhakaDateString(at: Date = new Date()): string {
  return new Date(at.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → Date at UTC midnight (what Prisma expects for @db.Date). */
export function dateOnly(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Bad date: ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** @db.Date value → "YYYY-MM-DD". */
export function ymdOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dhaka wall-clock date + "HH:mm" → the UTC instant. */
export function dhakaWallTimeToUtc(ymd: string, hhmm: string): Date {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new Error(`Bad time: ${hhmm}`);
  return new Date(new Date(`${ymd}T${hhmm}:00.000Z`).getTime() - DHAKA_OFFSET_MS);
}

/** Weekday (0 = Sunday) of a "YYYY-MM-DD" calendar date. */
export function weekdayOf(ymd: string): number {
  return dateOnly(ymd).getUTCDay();
}

/** "YYYY-MM-DD" + n days. */
export function addDays(ymd: string, days: number): string {
  return new Date(dateOnly(ymd).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

const dateFmt = new Intl.DateTimeFormat("bn-BD", {
  timeZone: DHAKA_TZ,
  day: "numeric",
  month: "long",
  weekday: "long",
});
const dateShortFmt = new Intl.DateTimeFormat("bn-BD", {
  timeZone: DHAKA_TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Bangla time-of-day word, the way people say it ("বিকাল ৫টা"), not AM/PM. */
function dayPeriod(hour: number): string {
  if (hour >= 4 && hour < 6) return "ভোর";
  if (hour >= 6 && hour < 12) return "সকাল";
  if (hour >= 12 && hour < 15) return "দুপুর";
  if (hour >= 15 && hour < 18) return "বিকাল";
  if (hour >= 18 && hour < 20) return "সন্ধ্যা";
  return "রাত";
}

/** "বিকাল ৫:৩০" style time in Dhaka. */
export function formatTime(at: Date): string {
  const d = new Date(at.getTime() + DHAKA_OFFSET_MS);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dayPeriod(h)} ${bn(h12)}:${bn(String(m).padStart(2, "0"))}`;
}

/** "সোমবার, ১০ নভেম্বর" in Dhaka. */
export function formatDate(at: Date): string {
  return dateFmt.format(at);
}

/** "১০ নভে, ২০২৬" in Dhaka. */
export function formatDateShort(at: Date): string {
  return dateShortFmt.format(at);
}

/** "17:30" → "বিকাল ৫:৩০" (a schedule wall time, no date). */
export function formatWallTime(hhmm: string): string {
  return formatTime(dhakaWallTimeToUtc("2000-01-01", hhmm));
}
