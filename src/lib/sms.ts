import { prisma } from "@/lib/db";
import type { Prisma, SmsTemplate } from "@/generated/prisma/client";
import { patientLink, renderSms, smsSegments, type TemplateInput } from "@/lib/sms-text";

/**
 * SMS sending. Messages are written as QUEUED rows inside the queue
 * transaction (an outbox), then sent after commit. A row is claimed
 * (QUEUED → SENDING) with SKIP LOCKED before sending, so with several
 * instances a message still goes out once. Failures retry up to 3 times.
 * Every row stays as the per-organization billing log.
 */

export type SendResult = { ok: true; id?: string } | { ok: false; error: string; retryable: boolean };

export interface SmsProvider {
  readonly name: string;
  /** `to` is 8801XXXXXXXXX. */
  send(to: string, body: string): Promise<SendResult>;
}

/** Development provider: prints the message instead of sending it. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  async send(to: string, body: string): Promise<SendResult> {
    console.log(`[sms] → +${to} (${smsSegments(body).segments} seg): ${body}`);
    return { ok: true, id: `console-${Date.now()}` };
  }
}

const g = globalThis as unknown as { liveserialSms?: { provider?: SmsProvider; sweeper?: ReturnType<typeof setInterval> } };
const state = (g.liveserialSms ??= {});

export function getSmsProvider(): SmsProvider {
  if (state.provider) return state.provider;
  const name = process.env.SMS_PROVIDER ?? "console";
  if (name !== "console") console.warn(`[sms] unknown SMS_PROVIDER "${name}", using console`);
  return (state.provider = new ConsoleSmsProvider());
}

/** Tests (and later a real gateway) can swap the provider. */
export function setSmsProvider(provider: SmsProvider | undefined) {
  state.provider = provider;
}

export function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

// ───────────── queueing (inside a queue transaction) ─────────────

export type SmsToQueue = {
  organizationId: string;
  sessionId: string;
  tokenId: string;
  toPhone: string;
  template: SmsTemplate;
  publicCode: string;
  input: Omit<TemplateInput, "link">;
  sentById?: string | null;
};

export function buildSmsRow(m: SmsToQueue): Prisma.SmsMessageCreateManyInput {
  const body = renderSms(m.template, { ...m.input, link: patientLink(appBaseUrl(), m.publicCode) });
  const seg = smsSegments(body);
  return {
    organizationId: m.organizationId,
    sessionId: m.sessionId,
    tokenId: m.tokenId,
    toPhone: m.toPhone,
    template: m.template,
    body,
    segments: seg.segments,
    isUnicode: seg.encoding === "UCS2",
    provider: getSmsProvider().name,
    sentById: m.sentById ?? null,
  };
}

/**
 * Inserts QUEUED messages. An automatic trigger that already exists for a token
 * is silently skipped (partial unique index + ON CONFLICT DO NOTHING), so the
 * same trigger is never sent twice and a token gets at most 3 automatic SMS.
 */
export async function queueSms(tx: Prisma.TransactionClient, messages: SmsToQueue[]): Promise<number> {
  if (messages.length === 0) return 0;
  const { count } = await tx.smsMessage.createMany({ data: messages.map(buildSmsRow), skipDuplicates: true });
  return count;
}

// ───────────── sending ─────────────

const MAX_ATTEMPTS = 3;
const RETRY_AFTER = "20 seconds"; // pause before retrying a failed send (the 30 s sweeper picks it up)
const STUCK_AFTER = "2 minutes"; // a SENDING row older than this (crashed sender) can be claimed again
let flushing: Promise<number> | null = null;
let again = false;

type Claimed = { id: string; toPhone: string; body: string; attempts: number };

/** Sends queued messages until none are left. Returns how many were attempted. */
export function flushOutbox(): Promise<number> {
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = (async () => {
    let total = 0;
    try {
      do {
        again = false;
        for (;;) {
          const batch = await prisma.$queryRaw<Claimed[]>`
            UPDATE "SmsMessage" SET status = 'SENDING', attempts = attempts + 1, "lastAttemptAt" = now()
            WHERE id IN (
              SELECT id FROM "SmsMessage"
              WHERE (
                  (status = 'QUEUED' AND ("lastAttemptAt" IS NULL OR "lastAttemptAt" < now() - ${RETRY_AFTER}::interval))
                  OR (status = 'SENDING' AND "lastAttemptAt" < now() - ${STUCK_AFTER}::interval)
                )
                AND attempts < ${MAX_ATTEMPTS}
              ORDER BY "createdAt"
              LIMIT 20
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, "toPhone", body, attempts`;
          if (batch.length === 0) break;
          total += batch.length;
          await Promise.all(batch.map(sendOne));
        }
      } while (again);
    } catch (e) {
      console.error("[sms] flush failed", e);
    } finally {
      flushing = null;
    }
    return total;
  })();
  return flushing;
}

async function sendOne(m: Claimed) {
  let result: SendResult;
  try {
    result = await getSmsProvider().send(m.toPhone, m.body);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
  if (result.ok) {
    await prisma.smsMessage.update({
      where: { id: m.id },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.id ?? null, error: null },
    });
  } else {
    const giveUp = !result.retryable || m.attempts >= MAX_ATTEMPTS;
    await prisma.smsMessage.update({
      where: { id: m.id },
      data: { status: giveUp ? "FAILED" : "QUEUED", error: result.error.slice(0, 500) },
    });
  }
}

/** Fire-and-forget send after a commit; also makes sure the retry sweeper runs. */
export function kickOutbox() {
  ensureSweeper();
  void flushOutbox();
}

/** Every 30 s, retry anything left QUEUED (failed attempts, crashed senders). */
export function ensureSweeper() {
  if (state.sweeper || process.env.NODE_ENV === "test") return;
  state.sweeper = setInterval(() => void flushOutbox(), 30_000);
  state.sweeper.unref?.();
}
