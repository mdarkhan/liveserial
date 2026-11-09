import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly, dhakaDateString, dhakaWallTimeToUtc } from "@/lib/format";
import {
  addTokens,
  cancelSession,
  cancelToken,
  editToken,
  NOTIFY_CHANNEL,
  QueueError,
  type QueueCtx,
} from "@/lib/queue-service";

afterAll(() => prisma.$disconnect());

/** A fresh tenant per test keeps tests independent without truncating (QueueEvent is append-only). */
async function makeTenant() {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Org ${tag}`, slug: `org-${tag}` } });
  const user = await prisma.user.create({
    data: { name: "Assistant", email: `${tag}@phone.invalid`, role: "ASSISTANT", organizationId: org.id },
  });
  const doctor = await prisma.doctor.create({ data: { organizationId: org.id, name: "Dr. Test" } });
  const chamber = await prisma.chamber.create({ data: { organizationId: org.id, name: "Room" } });
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
  const ctx = (rid: string = randomUUID()): QueueCtx => ({
    orgId: org.id,
    userId: user.id,
    sessionId: session.id,
    clientRequestId: rid,
  });
  return { org, user, session, ctx };
}

const patient = (name: string) => ({ name, phone: null });

describe("addTokens", () => {
  it("gives unique consecutive serials under 20 concurrent adds", async () => {
    const { session, ctx } = await makeTenant();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => addTokens(ctx(), [patient(`P${i}`)])));
    const serials = results.map((r) => r[0].serial).sort((a, b) => a - b);
    expect(serials).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));

    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.nextSerial).toBe(21);
    expect(s.queueVersion).toBe(20);
    expect(await prisma.queueEvent.count({ where: { sessionId: session.id, action: "TOKEN_ADDED" } })).toBe(20);
  });

  it("applies a retried request only once and returns the same result", async () => {
    const { session, ctx } = await makeTenant();
    const rid = randomUUID();
    const [first, second, third] = await Promise.all([
      addTokens(ctx(rid), [patient("A")]),
      addTokens(ctx(rid), [patient("A")]),
      addTokens(ctx(rid), [patient("A")]),
    ]);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await prisma.token.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it("honours explicit serials, rejects taken ones, and fills gaps for auto serials", async () => {
    const { ctx } = await makeTenant();
    await addTokens(ctx(), [
      { ...patient("one"), serial: 1 },
      { ...patient("five"), serial: 5 },
    ]);
    await expect(addTokens(ctx(), [{ ...patient("dup"), serial: 5 }])).rejects.toMatchObject({ code: "SERIAL_TAKEN" });
    const [auto] = await addTokens(ctx(), [patient("auto")]);
    expect(auto.serial).toBe(6);
    const [gap] = await addTokens(ctx(), [{ ...patient("gap"), serial: 3 }]);
    expect(gap.serial).toBe(3);
  });

  it("writes queueOrder = serial and a 10-char public code", async () => {
    const { ctx } = await makeTenant();
    const [added] = await addTokens(ctx(), [patient("A")]);
    const token = await prisma.token.findUniqueOrThrow({ where: { id: added.id } });
    expect(token.queueOrder).toBe(token.serial);
    expect(token.publicCode).toHaveLength(10);
  });
});

describe("tenant isolation", () => {
  it("cannot touch another organization's session", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const foreign: QueueCtx = { ...b.ctx(), sessionId: a.session.id };
    await expect(addTokens(foreign, [patient("intruder")])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.token.count({ where: { sessionId: a.session.id } })).toBe(0);
  });

  it("cannot replay another user's request id", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const rid = randomUUID();
    await addTokens(a.ctx(rid), [patient("A")]);
    await expect(addTokens(b.ctx(rid), [patient("B")])).rejects.toBeInstanceOf(QueueError);
  });
});

describe("edit / cancel", () => {
  it("logs edits with before/after", async () => {
    const { ctx } = await makeTenant();
    const [added] = await addTokens(ctx(), [patient("Old Name")]);
    await editToken(ctx(), added.id, { name: "New Name", phone: "8801711000000", isEmergency: true });
    const ev = await prisma.queueEvent.findFirstOrThrow({ where: { tokenId: added.id, action: "TOKEN_EDITED" } });
    expect(ev.meta).toMatchObject({ before: { name: "Old Name" }, after: { name: "New Name", emergency: true } });
  });

  it("cancels only waiting/skipped/no-show tokens", async () => {
    const { ctx } = await makeTenant();
    const [a, b] = await addTokens(ctx(), [patient("A"), patient("B")]);
    await cancelToken(ctx(), a.id);
    expect((await prisma.token.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELLED");

    await prisma.token.update({ where: { id: b.id }, data: { status: "CALLED" } });
    await expect(cancelToken(ctx(), b.id)).rejects.toMatchObject({ code: "INVALID" });
  });

  it("refuses changes once the session is cancelled", async () => {
    const { ctx } = await makeTenant();
    await cancelSession(ctx());
    await expect(addTokens(ctx(), [patient("late")])).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });
});

describe("database guards", () => {
  it("keeps QueueEvent append-only", async () => {
    const { ctx } = await makeTenant();
    const [added] = await addTokens(ctx(), [patient("A")]);
    const ev = await prisma.queueEvent.findFirstOrThrow({ where: { tokenId: added.id } });
    await expect(prisma.queueEvent.update({ where: { id: ev.id }, data: { note: "tamper" } })).rejects.toThrow();
    await expect(prisma.queueEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
  });

  it("allows only one now-serving token per session", async () => {
    const { ctx } = await makeTenant();
    const [a, b] = await addTokens(ctx(), [patient("A"), patient("B")]);
    await prisma.token.update({ where: { id: a.id }, data: { status: "CALLED" } });
    await expect(prisma.token.update({ where: { id: b.id }, data: { status: "IN_CONSULT" } })).rejects.toThrow();
  });

  it("NOTIFYs listeners with the session id and new version on commit", async () => {
    const { session, ctx } = await makeTenant();
    const listener = new Client({ connectionString: process.env.DATABASE_URL });
    await listener.connect();
    try {
      await listener.query(`LISTEN ${NOTIFY_CHANNEL}`);
      const got = new Promise<{ s: string; v: number }>((resolve) => {
        listener.on("notification", (n) => {
          const msg = JSON.parse(n.payload ?? "{}");
          if (msg.s === session.id) resolve(msg);
        });
      });
      await addTokens(ctx(), [patient("A")]);
      await expect(got).resolves.toEqual({ s: session.id, v: 1 });
    } finally {
      await listener.end();
    }
  });
});
