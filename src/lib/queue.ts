/**
 * Pure queue rules — no DB, no Node-only APIs, so they run in tests, on the
 * server (queue-service.ts) and in the browser (bulk-add preview).
 */
import type { SessionStatus, TokenStatus } from "@/generated/prisma/enums";
import { normalizeBdPhone, toAsciiDigits } from "@/lib/format";

export type QueueToken = { id: string; serial: number; queueOrder: number; status: TokenStatus };

export const ACTIVE: readonly TokenStatus[] = ["CALLED", "IN_CONSULT"];
export const AWAY: readonly TokenStatus[] = ["SKIPPED", "NO_SHOW"];
export const CLOSED_SESSION: readonly SessionStatus[] = ["ENDED", "CANCELLED"];

/** Queue order: queueOrder, then serial. */
export function byQueueOrder(a: QueueToken, b: QueueToken): number {
  return a.queueOrder - b.queueOrder || a.serial - b.serial;
}

/** WAITING tokens in the order they'll be called. */
export function waitingInOrder<T extends QueueToken>(tokens: T[]): T[] {
  return tokens.filter((t) => t.status === "WAITING").sort(byQueueOrder);
}

/** The patient currently with the doctor (CALLED or IN_CONSULT), if any. */
export function nowServing<T extends QueueToken>(tokens: T[]): T | undefined {
  return tokens.find((t) => ACTIVE.includes(t.status));
}

/** Who "next" would call. */
export function nextToCall<T extends QueueToken>(tokens: T[]): T | undefined {
  return waitingInOrder(tokens)[0];
}

/**
 * Serials that would be jumped if `target` were called now (WAITING tokens
 * ahead of it). Empty means calling it is in order.
 */
export function jumpedSerials(target: QueueToken, tokens: QueueToken[]): number[] {
  return waitingInOrder(tokens)
    .filter((t) => t.id !== target.id && byQueueOrder(t, target) < 0)
    .map((t) => t.serial);
}

/**
 * People ahead of `token`: WAITING tokens before it, plus the patient inside
 * (if that's someone else). So 1 means "you're next".
 */
export function peopleAhead(token: QueueToken, tokens: QueueToken[]): number {
  if (token.status !== "WAITING") return 0;
  const inside = nowServing(tokens);
  return jumpedSerials(token, tokens).length + (inside && inside.id !== token.id ? 1 : 0);
}

export type RequeueMode = "AFTER_CURRENT" | "AT_END";

/**
 * queueOrder for a re-queued token. "After current" puts it first among the
 * waiting (so it's called next); "at end" after everyone.
 */
export function requeueOrder(mode: RequeueMode, tokens: QueueToken[]): number {
  const maxOrder = tokens.reduce((m, t) => Math.max(m, t.queueOrder), 0);
  if (mode === "AT_END") return maxOrder + 1;
  const first = waitingInOrder(tokens)[0];
  return first ? first.queueOrder - 1 : maxOrder + 1;
}

// ───────────── Session status ─────────────

export type DoctorStatusAction = "ARRIVED" | "BREAK" | "RESUME" | "END";

const SESSION_TRANSITIONS: Record<DoctorStatusAction, { from: SessionStatus[]; to: SessionStatus }> = {
  ARRIVED: { from: ["NOT_STARTED"], to: "DOCTOR_ARRIVED" },
  BREAK: { from: ["DOCTOR_ARRIVED", "RUNNING"], to: "ON_BREAK" },
  RESUME: { from: ["ON_BREAK"], to: "RUNNING" },
  END: { from: ["NOT_STARTED", "DOCTOR_ARRIVED", "RUNNING", "ON_BREAK"], to: "ENDED" },
};

/** Target status, or null if the action isn't allowed from `from`. */
export function sessionTransition(action: DoctorStatusAction, from: SessionStatus): SessionStatus | null {
  const rule = SESSION_TRANSITIONS[action];
  return rule.from.includes(from) ? rule.to : null;
}

/** Doctor actions offered for the current status (for the console buttons). */
export function availableDoctorActions(status: SessionStatus): DoctorStatusAction[] {
  return (Object.keys(SESSION_TRANSITIONS) as DoctorStatusAction[]).filter((a) => sessionTransition(a, status));
}

// ───────────── Out-of-order reasons ─────────────

export const OUT_OF_ORDER_REASONS = ["EMERGENCY", "LATE_ARRIVAL", "REPORT_CHECK", "ELDERLY_OR_DISABLED", "OTHER"] as const;
export type OutOfOrderReasonCode = (typeof OUT_OF_ORDER_REASONS)[number];

// ───────────── Public codes ─────────────

/** No look-alikes (0/O, 1/l/I). 55 symbols × 10 chars ≈ 57.8 bits. */
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** Crypto-random, unbiased (rejection sampling). */
export function generatePublicCode(length = 10): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && out.length < length) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** UUID v4 for client request ids. crypto.randomUUID needs HTTPS/localhost, so fall back. */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ───────────── Bulk add ─────────────

export type BulkPatient = { line: number; serial?: number; name: string; phone: string | null };
export type BulkError = { line: number; text: string; reason: "NO_NAME" | "BAD_SERIAL" | "DUPLICATE_SERIAL" | "TOO_LONG" };

const PHONE_IN_TEXT = /(?:\+?\s*88[\s-]*)?0\s*1[3-9](?:[\s-]*\d){8}/;
export const BULK_MAX_LINES = 200;

/**
 * Parses a pasted list, one patient per line: `[serial] name [phone]`.
 * Serial may be followed by . ) - : or a space. Bangla digits are fine.
 *   "১২. রহিম উদ্দিন ০১৭১১-০০০০০০" → serial 12, "রহিম উদ্দিন", 8801711000000
 */
export function parseBulkList(text: string): { patients: BulkPatient[]; errors: BulkError[] } {
  const patients: BulkPatient[] = [];
  const errors: BulkError[] = [];
  const seen = new Set<number>();
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, i) => {
    const line = i + 1;
    const original = rawLine.trim();
    if (!original) return;
    let rest = toAsciiDigits(original);

    let phone: string | null = null;
    const pm = rest.match(PHONE_IN_TEXT);
    if (pm) {
      phone = normalizeBdPhone(pm[0].replace(/\s/g, ""));
      rest = (rest.slice(0, pm.index) + " " + rest.slice((pm.index ?? 0) + pm[0].length)).trim();
    }

    let serial: number | undefined;
    const sm = rest.match(/^(\d{1,4})(?:[.)\-:,।]\s*|\s+)/);
    if (sm) {
      serial = Number(sm[1]);
      rest = rest.slice(sm[0].length);
    }

    const name = rest.replace(/^[\s,;:|\-–]+|[\s,;:|\-–]+$/g, "").replace(/\s+/g, " ");
    if (!name) return errors.push({ line, text: original, reason: "NO_NAME" });
    if (name.length > 120) return errors.push({ line, text: original, reason: "TOO_LONG" });
    if (serial !== undefined && (serial < 1 || serial > 9999)) return errors.push({ line, text: original, reason: "BAD_SERIAL" });
    if (serial !== undefined) {
      if (seen.has(serial)) return errors.push({ line, text: original, reason: "DUPLICATE_SERIAL" });
      seen.add(serial);
    }
    patients.push({ line, serial, name, phone });
  });

  return { patients, errors };
}
