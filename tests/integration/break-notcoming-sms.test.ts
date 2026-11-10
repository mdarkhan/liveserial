import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly, dhakaDateString, dhakaWallTimeToUtc } from "@/lib/format";
import {
  addTokens,
  callNext,
  patientNotComing,
  requeue,
  setDoctorStatus,
  tokenAction,
  type QueueCtx,
} from "@/lib/queue-service";
import { getSmsUsage } from "@/lib/reports";
import { loadSessionData, projectConsole, projectDisplay, projectPatient } from "@/lib/snapshot";

afterAll(() => prisma.$disconnect());

async function makeTenant() {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Org ${tag}`, slug: `org-${tag}` } });
  const user = await prisma.user.create({
    data: { name: "A", email: `${tag}@phone.invalid`, role: "ASSISTANT", organizationId: org.id },
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
  return { org, user, session, ctx, today };
}

const tokens = (sessionId: string) => prisma.token.findMany({ where: { sessionId }, orderBy: { serial: "asc" } });

describe("timed doctor break", () => {
  it("stores kind + end time, shows it to patient and TV, adds it to the ETA, and resume clears it", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [1, 2, 3, 4].map((i) => ({ name: `P${i}`, phone: null })));
    await callNext(ctx(), null);
    const [, , third] = await tokens(session.id);

    let d = (await loadSessionData(session.id))!;
    const before = projectPatient(d, third.publicCode)!.you.eta!;

    const t0 = Date.now();
    await setDoctorStatus(ctx(), "BREAK", { minutes: 15, kind: "PRAYER" });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.status).toBe("ON_BREAK");
    expect(s.breakKind).toBe("PRAYER");
    const ends = s.breakEndsAt!.getTime() - t0;
    expect(ends).toBeGreaterThan(14.9 * 60_000);
    expect(ends).toBeLessThan(15.1 * 60_000);

    d = (await loadSessionData(session.id))!;
    const pv = projectPatient(d, third.publicCode)!;
    expect(pv.session.breakKind).toBe("PRAYER");
    expect(pv.session.breakEndsAt).toBe(s.breakEndsAt!.toISOString());
    expect(projectDisplay(d).breakEndsAt).toBe(s.breakEndsAt!.toISOString());
    expect(pv.you.eta!.includesBreak).toBe(true);
    expect(pv.you.eta!.low).toBeGreaterThanOrEqual(before.low + 10); // ~15 more minutes

    const ev = await prisma.queueEvent.findFirst({
      where: { sessionId: session.id, toStatus: "ON_BREAK" },
      orderBy: { id: "desc" },
    });
    expect(ev!.meta).toMatchObject({ breakMinutes: 15, breakKind: "PRAYER" });

    await setDoctorStatus(ctx(), "RESUME");
    const r = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(r).toMatchObject({ status: "RUNNING", breakKind: null, breakEndsAt: null });
  });

  it("a plain break has no timer; a timer only goes with BREAK", async () => {
    const { session, ctx } = await makeTenant();
    await setDoctorStatus(ctx(), "ARRIVED");
    await setDoctorStatus(ctx(), "BREAK");
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(s).toMatchObject({ status: "ON_BREAK", breakKind: null, breakEndsAt: null });
    await expect(setDoctorStatus(ctx(), "RESUME", { minutes: 10, kind: "BREAK" })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(setDoctorStatus(ctx(), "BREAK", { minutes: 0, kind: "BREAK" })).rejects.toMatchObject({
      code: "INVALID",
    });
  });

  it("a timer is not shown once the session is no longer on break", async () => {
    const { session, ctx } = await makeTenant();
    await setDoctorStatus(ctx(), "ARRIVED");
    await setDoctorStatus(ctx(), "BREAK", { minutes: 10, kind: "BREAK" });
    await setDoctorStatus(ctx(), "END");
    const d = (await loadSessionData(session.id))!;
    expect(projectDisplay(d).breakEndsAt).toBeNull();
  });
});

describe("patient: I'm not coming", () => {
  it("cancels the patient's own waiting serial, logs it without a staff actor, and moves others up", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [1, 2, 3].map((i) => ({ name: `P${i}`, phone: null })));
    const [a, b, c] = await tokens(session.id);
    expect(projectPatient((await loadSessionData(session.id))!, c.publicCode)!.you.peopleAhead).toBe(2);

    await patientNotComing(b.publicCode, randomUUID());
    const nb = await prisma.token.findUniqueOrThrow({ where: { id: b.id } });
    expect(nb.status).toBe("CANCELLED");
    expect(nb.cancelledByPatientAt).not.toBeNull();

    const ev = await prisma.queueEvent.findFirstOrThrow({ where: { tokenId: b.id, action: "PATIENT_NOT_COMING" } });
    expect(ev.actorId).toBeNull();
    expect(ev).toMatchObject({ fromStatus: "WAITING", toStatus: "CANCELLED" });

    const d = (await loadSessionData(session.id))!;
    expect(projectPatient(d, c.publicCode)!.you.peopleAhead).toBe(1);
    expect(projectPatient(d, b.publicCode)!.you.notComing).toBe(true);
    const cv = projectConsole(d);
    expect(cv.away.map((x) => [x.serial, x.notComing])).toEqual([[2, true]]);
    expect(cv.waiting.map((x) => x.serial)).toEqual([a.serial, c.serial]);
  });

  it("is idempotent by request id and refused once the patient has been called", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [1, 2].map((i) => ({ name: `P${i}`, phone: null })));
    const [a, b] = await tokens(session.id);
    const rid = randomUUID();
    const [r1, r2] = await Promise.all([patientNotComing(b.publicCode, rid), patientNotComing(b.publicCode, rid)]);
    expect(r2).toEqual(r1);
    expect(await prisma.queueEvent.count({ where: { tokenId: b.id, action: "PATIENT_NOT_COMING" } })).toBe(1);

    await callNext(ctx(), null); // calls a
    await expect(patientNotComing(a.publicCode, randomUUID())).rejects.toMatchObject({ code: "INVALID" });
    await expect(patientNotComing("nope-nope-1", randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("also works for a skipped patient; staff can put them back in line", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [1, 2].map((i) => ({ name: `P${i}`, phone: null })));
    const [, b] = await tokens(session.id);
    await tokenAction(ctx(), b.id, "SKIP");
    await patientNotComing(b.publicCode, randomUUID());
    await requeue(ctx(), b.id, "AT_END");
    const nb = await prisma.token.findUniqueOrThrow({ where: { id: b.id } });
    expect(nb).toMatchObject({ status: "WAITING", cancelledByPatientAt: null });
  });

  it("staff can't re-queue a serial they cancelled themselves", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "P", phone: null }]);
    const [a] = await tokens(session.id);
    const { cancelToken } = await import("@/lib/queue-service");
    await cancelToken(ctx(), a.id);
    await expect(requeue(ctx(), a.id, "AT_END")).rejects.toMatchObject({ code: "INVALID" });
  });

  it("refused once the session has ended", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "P", phone: null }]);
    const [a] = await tokens(session.id);
    await setDoctorStatus(ctx(), "END");
    await expect(patientNotComing(a.publicCode, randomUUID())).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });
});

describe("SMS monthly limit", () => {
  it("reports each organization's allowance and whether it is near or over", async () => {
    const { org, session } = await makeTenant();
    const ym = dhakaDateString().slice(0, 7);
    const row = async () => (await getSmsUsage(ym)).find((r) => r.orgId === org.id)!;
    expect(await row()).toMatchObject({ limit: null, limitStatus: "NONE" });

    await prisma.organization.update({ where: { id: org.id }, data: { smsMonthlyLimit: 10 } });
    const sms = (segments: number) =>
      prisma.smsMessage.create({
        data: {
          organizationId: org.id,
          sessionId: session.id,
          toPhone: "8801711000000",
          template: "DELAY_BROADCAST",
          body: "x",
          segments,
          isUnicode: true,
          status: "SENT",
          provider: "console",
          sentAt: new Date(),
        },
      });
    await sms(7);
    expect((await row()).limitStatus).toBe("OK");
    await sms(1);
    expect((await row()).limitStatus).toBe("NEAR");
    await sms(3);
    expect(await row()).toMatchObject({ sentSegments: 11, limit: 10, limitStatus: "OVER" });
  });
});
