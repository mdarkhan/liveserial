import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly, dhakaDateString, dhakaWallTimeToUtc } from "@/lib/format";
import { addTokens, broadcastDelay, callNext, callToken, type QueueCtx } from "@/lib/queue-service";
import { flushOutbox, setSmsProvider, type SendResult, type SmsProvider } from "@/lib/sms";

/** Records sends; can be told to fail. */
class FakeProvider implements SmsProvider {
  readonly name = "fake";
  sent: Array<{ to: string; body: string }> = [];
  failNext = 0;
  permanent = false;
  async send(to: string, body: string): Promise<SendResult> {
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, error: "gateway down", retryable: !this.permanent };
    }
    this.sent.push({ to, body });
    return { ok: true, id: `fake-${this.sent.length}` };
  }
}
const fake = new FakeProvider();

beforeAll(() => setSmsProvider(fake));
afterAll(async () => {
  setSmsProvider(undefined);
  await prisma.$disconnect();
});

/** A session with `n` patients, all with phones, threshold 3. */
async function makeSession(n: number, threshold = 3) {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Org ${tag}`, slug: `sms-${tag}` } });
  const user = await prisma.user.create({
    data: { name: "Assistant", email: `${tag}@phone.invalid`, role: "ASSISTANT", organizationId: org.id },
  });
  const doctor = await prisma.doctor.create({ data: { organizationId: org.id, name: "ডা. পরীক্ষা" } });
  const chamber = await prisma.chamber.create({
    data: { organizationId: org.id, name: "Room", leaveNowThreshold: threshold },
  });
  const today = dhakaDateString();
  const session = await prisma.session.create({
    data: {
      organizationId: org.id,
      doctorId: doctor.id,
      chamberId: chamber.id,
      date: dateOnly(today),
      scheduledStartAt: dhakaWallTimeToUtc(today, "17:00"),
    },
  });
  const ctx = (): QueueCtx => ({ orgId: org.id, userId: user.id, sessionId: session.id, clientRequestId: randomUUID() });
  const added = await addTokens(
    ctx(),
    Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, phone: `8801711${String(i).padStart(6, "0")}` })),
  );
  const id = (serial: number) => added.find((a) => a.serial === serial)!.id;
  const sms = async (serial: number) =>
    (
      await prisma.smsMessage.findMany({ where: { tokenId: id(serial) }, orderBy: { createdAt: "asc" } })
    ).map((m) => m.template);
  const current = async () =>
    (await prisma.token.findFirst({ where: { sessionId: session.id, status: { in: ["CALLED", "IN_CONSULT"] } } }))?.id ??
    null;
  const next = async () => callNext(ctx(), await current());
  return { session, ctx, id, sms, next };
}

describe("automatic SMS triggers", () => {
  it("sends the creation SMS with the live link (not for walk-ins without a phone)", async () => {
    const s = await makeSession(2);
    expect(await s.sms(1)).toEqual(["TOKEN_CREATED"]);
    const msg = await prisma.smsMessage.findFirstOrThrow({ where: { tokenId: s.id(1) } });
    const token = await prisma.token.findUniqueOrThrow({ where: { id: s.id(1) } });
    expect(msg.body).toContain(`/t/${token.publicCode}`);
    expect(msg.body).toContain("সিরিয়াল ১");
    expect(msg.isUnicode).toBe(true);

    const [walkIn] = await addTokens(s.ctx(), [{ name: "Walk-in", phone: null }]);
    expect(await prisma.smsMessage.count({ where: { tokenId: walkIn.id } })).toBe(0);
  });

  it("fires 'leave now' at the threshold and 'you're next' at 1, once each", async () => {
    const s = await makeSession(8, 3);
    // Serial 6: ahead starts at 5. Each "next" moves the line by one.
    await s.next(); // 1 inside → serial 6 has 5 ahead (4 waiting + 1 inside)
    expect(await s.sms(6)).toEqual(["TOKEN_CREATED"]);
    await s.next(); // 4
    await s.next(); // 3 → crossed the threshold
    expect(await s.sms(6)).toEqual(["TOKEN_CREATED", "LEAVE_NOW"]);
    await s.next(); // 2
    expect(await s.sms(6)).toEqual(["TOKEN_CREATED", "LEAVE_NOW"]);
    await s.next(); // 1 → you're next
    expect(await s.sms(6)).toEqual(["TOKEN_CREATED", "LEAVE_NOW", "NEXT_UP"]);
    await s.next(); // serial 6 is called: no more automatic SMS
    expect(await s.sms(6)).toHaveLength(3);
  });

  it("still notifies when an out-of-order call jumps past the threshold", async () => {
    const s = await makeSession(8, 3);
    await s.next(); // 1 inside; serial 5 has 4 ahead
    await callToken(s.ctx(), {
      tokenId: s.id(2),
      expectedCurrentTokenId: s.id(1),
    }); // in order, 2 inside: serial 5 → 3 ahead
    expect(await s.sms(5)).toContain("LEAVE_NOW");
  });

  it("sends only 'you're next' when both thresholds are crossed at once", async () => {
    const s = await makeSession(4, 3);
    // Serial 4: 3 waiting ahead, nobody inside → 3 ahead (≤ threshold already at creation: no LEAVE_NOW).
    await s.next(); // 1 inside → 2 waiting + 1 inside = 3 (no crossing)
    expect(await s.sms(4)).toEqual(["TOKEN_CREATED"]);
    await callToken(s.ctx(), {
      tokenId: s.id(3),
      expectedCurrentTokenId: s.id(1),
      reason: "EMERGENCY",
    }); // 3 inside, 2 waiting ahead → 2 (still ≤ 3, no crossing)
    await s.next(); // 2 inside → 1
    expect(await s.sms(4)).toEqual(["TOKEN_CREATED", "NEXT_UP"]);
  });
});

describe("outbox", () => {
  it("sends queued messages once and marks them SENT", async () => {
    const s = await makeSession(2);
    fake.sent = [];
    await flushOutbox();
    const rows = await prisma.smsMessage.findMany({ where: { sessionId: s.session.id } });
    expect(rows.every((r) => r.status === "SENT" && r.sentAt && r.providerMessageId)).toBe(true);
    // Running it again doesn't resend.
    const before = fake.sent.length;
    await flushOutbox();
    expect(fake.sent.length).toBe(before);
  });

  it("retries a failed send and gives up after 3 attempts", async () => {
    const s = await makeSession(1);
    await flushOutbox(); // creation SMS sent
    fake.failNext = 100;
    await broadcastDelay(s.ctx(), 30);
    await flushOutbox(); // attempt 1 fails → back to QUEUED
    const row = () =>
      prisma.smsMessage.findFirstOrThrow({ where: { sessionId: s.session.id, template: "DELAY_BROADCAST" } });
    expect(await row()).toMatchObject({ status: "QUEUED", attempts: 1, error: "gateway down" });
    // Not retried immediately…
    await flushOutbox();
    expect(await row()).toMatchObject({ attempts: 1 });
    // …only after the retry pause (simulated by moving the last attempt back in time).
    const age = async () => {
      const r = await row();
      await prisma.smsMessage.update({ where: { id: r.id }, data: { lastAttemptAt: new Date(Date.now() - 60_000) } });
    };
    await age();
    await flushOutbox();
    expect(await row()).toMatchObject({ status: "QUEUED", attempts: 2 });
    await age();
    await flushOutbox();
    expect(await row()).toMatchObject({ status: "FAILED", attempts: 3 });
    fake.failNext = 0;
  });

  it("does not retry a permanent failure", async () => {
    const s = await makeSession(1);
    fake.failNext = 1;
    fake.permanent = true;
    await flushOutbox();
    fake.permanent = false;
    const row = await prisma.smsMessage.findFirstOrThrow({ where: { sessionId: s.session.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 1 });
  });
});

describe("delay broadcast", () => {
  it("messages every waiting patient with a phone, logs it, and sets the announced delay", async () => {
    const s = await makeSession(4);
    await s.next(); // serial 1 inside: not a recipient
    await addTokens(s.ctx(), [{ name: "No phone", phone: null }]);
    const res = await broadcastDelay(s.ctx(), 30);
    expect(res.recipients).toBe(3);
    expect(res.segments).toBeGreaterThanOrEqual(3);

    const msgs = await prisma.smsMessage.findMany({ where: { sessionId: s.session.id, template: "DELAY_BROADCAST" } });
    expect(msgs).toHaveLength(3);
    expect(msgs[0].body).toContain("৩০ মিনিট দেরিতে");
    const ev = await prisma.queueEvent.findFirstOrThrow({ where: { sessionId: s.session.id, action: "DELAY_BROADCAST" } });
    expect(ev.meta).toMatchObject({ minutes: 30, recipients: 3 });
    // The doctor had "arrived" (first call), so the announced delay isn't changed.
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).announcedDelayMinutes).toBeNull();
  });

  it("can be sent again (not limited like automatic SMS) and sets the delay before arrival", async () => {
    const s = await makeSession(2);
    await broadcastDelay(s.ctx(), 20);
    await broadcastDelay(s.ctx(), 40);
    expect(await prisma.smsMessage.count({ where: { sessionId: s.session.id, template: "DELAY_BROADCAST" } })).toBe(4);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).announcedDelayMinutes).toBe(40);
  });
});
