import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly, dhakaDateString, dhakaWallTimeToUtc } from "@/lib/format";
import {
  addTokens,
  callNext,
  callToken,
  QueueError,
  requeue,
  setDelay,
  setDoctorStatus,
  tokenAction,
  type QueueCtx,
} from "@/lib/queue-service";

afterAll(() => prisma.$disconnect());

async function makeSession(patients = 5) {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Org ${tag}`, slug: `qa-${tag}` } });
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
  const added = await addTokens(
    ctx(),
    Array.from({ length: patients }, (_, i) => ({ name: `P${i + 1}`, phone: null })),
  );
  const id = (serial: number) => added.find((a) => a.serial === serial)!.id;
  const status = async () =>
    Object.fromEntries(
      (await prisma.token.findMany({ where: { sessionId: session.id }, orderBy: { serial: "asc" } })).map((t) => [
        t.serial,
        t.status,
      ]),
    );
  const current = async () =>
    (await prisma.token.findFirst({
      where: { sessionId: session.id, status: { in: ["CALLED", "IN_CONSULT"] } },
    })) ?? null;
  return { session, ctx, id, status, current };
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e) => (e instanceof QueueError ? e.code : `UNEXPECTED: ${e}`),
  );

describe("callNext", () => {
  it("finishes the patient inside and calls the next one, starting the session", async () => {
    const s = await makeSession(3);
    expect(await callNext(s.ctx(), null)).toEqual({ calledSerial: 1, completedSerial: null });
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(sess.status).toBe("RUNNING");
    expect(sess.doctorArrivedAt).not.toBeNull();

    expect(await callNext(s.ctx(), s.id(1))).toEqual({ calledSerial: 2, completedSerial: 1 });
    expect(await s.status()).toEqual({ 1: "DONE", 2: "CALLED", 3: "WAITING" });

    const actions = (
      await prisma.queueEvent.findMany({ where: { sessionId: s.session.id }, orderBy: { id: "asc" } })
    ).map((e) => e.action);
    expect(actions.slice(3)).toEqual(["SESSION_STATUS_CHANGED", "CALL_NEXT", "MARK_DONE", "CALL_NEXT"]);
  });

  it("20 assistants tapping at the same moment call exactly one patient", async () => {
    const s = await makeSession(10);
    const results = await Promise.all(Array.from({ length: 20 }, () => code(callNext(s.ctx(), null))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(results.filter((r) => r === "CONFLICT")).toHaveLength(19);
    const st = await s.status();
    expect(st[1]).toBe("CALLED");
    expect(Object.values(st).filter((v) => v === "WAITING")).toHaveLength(9);
  });

  it("concurrent taps while someone is inside still advance by exactly one", async () => {
    const s = await makeSession(10);
    await callNext(s.ctx(), null);
    const results = await Promise.all(Array.from({ length: 10 }, () => code(callNext(s.ctx(), s.id(1)))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await s.status()).toMatchObject({ 1: "DONE", 2: "CALLED", 3: "WAITING" });
  });

  it("a retried request (same id) is applied once", async () => {
    const s = await makeSession(5);
    const rid = randomUUID();
    const [a, b] = await Promise.all([callNext(s.ctx(rid), null), callNext(s.ctx(rid), null)]);
    expect(a).toEqual(b);
    expect((await s.current())?.serial).toBe(1);
    // Retrying later (e.g. the response was lost on 3G) replays instead of conflicting.
    await expect(callNext(s.ctx(rid), null)).resolves.toEqual(a);
    expect(await s.status()).toMatchObject({ 1: "CALLED", 2: "WAITING" });
  });

  it("rejects a stale view", async () => {
    const s = await makeSession(3);
    await callNext(s.ctx(), null);
    expect(await code(callNext(s.ctx(), null))).toBe("CONFLICT");
    expect(await code(callNext(s.ctx(), s.id(3)))).toBe("CONFLICT");
  });

  it("finishes the last patient, then reports an empty queue", async () => {
    const s = await makeSession(1);
    await callNext(s.ctx(), null);
    expect(await callNext(s.ctx(), s.id(1))).toEqual({ calledSerial: null, completedSerial: 1 });
    expect(await code(callNext(s.ctx(), null))).toBe("EMPTY");
  });

  it("refuses when the session has ended", async () => {
    const s = await makeSession(2);
    await setDoctorStatus(s.ctx(), "END");
    expect(await code(callNext(s.ctx(), null))).toBe("SESSION_CLOSED");
  });
});

describe("callToken (out of order)", () => {
  it("needs a reason when someone is jumped, and logs who was jumped", async () => {
    const s = await makeSession(5);
    expect(await code(callToken(s.ctx(), { tokenId: s.id(4), expectedCurrentTokenId: null }))).toBe("REASON_REQUIRED");
    expect(
      await code(callToken(s.ctx(), { tokenId: s.id(4), expectedCurrentTokenId: null, reason: "OTHER", note: " " })),
    ).toBe("REASON_REQUIRED");

    const res = await callToken(s.ctx(), { tokenId: s.id(4), expectedCurrentTokenId: null, reason: "EMERGENCY" });
    expect(res).toEqual({ calledSerial: 4, completedSerial: null, outOfOrder: true });

    const ev = await prisma.queueEvent.findFirstOrThrow({
      where: { sessionId: s.session.id, action: "CALL_OUT_OF_ORDER" },
    });
    expect(ev).toMatchObject({ isOutOfOrder: true, reason: "EMERGENCY", fromStatus: "WAITING", toStatus: "CALLED" });
    expect(ev.meta).toEqual({ serial: 4, jumpedSerials: [1, 2, 3] });

    // Afterwards the normal order continues from the lowest waiting serial.
    expect(await callNext(s.ctx(), s.id(4))).toEqual({ calledSerial: 1, completedSerial: 4 });
  });

  it("calling the patient who is next anyway is not out of order", async () => {
    const s = await makeSession(3);
    const res = await callToken(s.ctx(), { tokenId: s.id(1), expectedCurrentTokenId: null });
    expect(res.outOfOrder).toBe(false);
    expect(await prisma.queueEvent.count({ where: { sessionId: s.session.id, isOutOfOrder: true } })).toBe(0);
  });

  it("keeps the note for OTHER", async () => {
    const s = await makeSession(3);
    await callToken(s.ctx(), {
      tokenId: s.id(3),
      expectedCurrentTokenId: null,
      reason: "OTHER",
      note: "ডাক্তারের আত্মীয়",
    });
    const ev = await prisma.queueEvent.findFirstOrThrow({ where: { sessionId: s.session.id, isOutOfOrder: true } });
    expect(ev.note).toBe("ডাক্তারের আত্মীয়");
  });

  it("only waiting patients can be called", async () => {
    const s = await makeSession(3);
    await tokenAction(s.ctx(), s.id(2), "SKIP");
    expect(await code(callToken(s.ctx(), { tokenId: s.id(2), expectedCurrentTokenId: null }))).toBe("INVALID");
  });
});

describe("skip / no-show / re-queue", () => {
  it("re-queues a no-show right after the current patient", async () => {
    const s = await makeSession(5);
    await callNext(s.ctx(), null); // 1 called
    await tokenAction(s.ctx(), s.id(1), "NO_SHOW");
    await callNext(s.ctx(), null); // 2 called
    await callNext(s.ctx(), s.id(2)); // 3 called
    await requeue(s.ctx(), s.id(1), "AFTER_CURRENT");
    expect(await callNext(s.ctx(), s.id(3))).toMatchObject({ calledSerial: 1 });
    expect(await callNext(s.ctx(), s.id(1))).toMatchObject({ calledSerial: 4 });
  });

  it("re-queues a skipped patient at the end", async () => {
    const s = await makeSession(3);
    await tokenAction(s.ctx(), s.id(1), "SKIP");
    await requeue(s.ctx(), s.id(1), "AT_END");
    expect(await callNext(s.ctx(), null)).toMatchObject({ calledSerial: 2 });
    expect(await callNext(s.ctx(), s.id(2))).toMatchObject({ calledSerial: 3 });
    expect(await callNext(s.ctx(), s.id(3))).toMatchObject({ calledSerial: 1 });
  });

  it("enforces allowed transitions", async () => {
    const s = await makeSession(3);
    expect(await code(tokenAction(s.ctx(), s.id(1), "NO_SHOW"))).toBe("INVALID"); // not called yet
    expect(await code(tokenAction(s.ctx(), s.id(1), "IN_CONSULT"))).toBe("INVALID");
    expect(await code(requeue(s.ctx(), s.id(1), "AT_END"))).toBe("INVALID"); // already waiting
    await callNext(s.ctx(), null);
    expect(await code(tokenAction(s.ctx(), s.id(1), "SKIP"))).toBe("INVALID"); // already called
    await tokenAction(s.ctx(), s.id(1), "IN_CONSULT");
    const t1 = await prisma.token.findUniqueOrThrow({ where: { id: s.id(1) } });
    expect(t1.consultStartedAt).not.toBeNull();
    await tokenAction(s.ctx(), s.id(1), "DONE");
    expect((await s.current())).toBeNull();
  });
});

describe("doctor status and delay", () => {
  it("follows arrived → break → resume → end, and logs each change", async () => {
    const s = await makeSession(2);
    await setDoctorStatus(s.ctx(), "ARRIVED");
    expect(await code(setDoctorStatus(s.ctx(), "ARRIVED"))).toBe("INVALID");
    await callNext(s.ctx(), null);
    await setDoctorStatus(s.ctx(), "BREAK");
    await setDoctorStatus(s.ctx(), "RESUME");
    await setDoctorStatus(s.ctx(), "END");
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } });
    expect(sess.status).toBe("ENDED");
    expect(sess.endedAt).not.toBeNull();
    // The patient inside is finished; the one still waiting stays waiting (not seen).
    expect(await s.status()).toEqual({ 1: "DONE", 2: "WAITING" });
    const changes = await prisma.queueEvent.findMany({
      where: { sessionId: s.session.id, action: "SESSION_STATUS_CHANGED" },
      orderBy: { id: "asc" },
    });
    expect(changes.map((c) => `${c.fromStatus}>${c.toStatus}`)).toEqual([
      "NOT_STARTED>DOCTOR_ARRIVED",
      "DOCTOR_ARRIVED>RUNNING",
      "RUNNING>ON_BREAK",
      "ON_BREAK>RUNNING",
      "RUNNING>ENDED",
    ]);
  });

  it("calling next during a break resumes the session", async () => {
    const s = await makeSession(2);
    await callNext(s.ctx(), null);
    await setDoctorStatus(s.ctx(), "BREAK");
    await callNext(s.ctx(), s.id(1));
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).status).toBe("RUNNING");
  });

  it("records and clears the announced delay", async () => {
    const s = await makeSession(1);
    await setDelay(s.ctx(), 30);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).announcedDelayMinutes).toBe(30);
    await setDelay(s.ctx(), 0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).announcedDelayMinutes).toBeNull();
    await expect(setDelay(s.ctx(), -5)).rejects.toMatchObject({ code: "INVALID" });
  });
});
