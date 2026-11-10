import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly, dhakaDateString, dhakaWallTimeToUtc } from "@/lib/format";
import {
  addTokens,
  callNext,
  callToken,
  setDelay,
  tokenAction,
  undoAction,
  UNDO_WINDOW_MS,
  type QueueCtx,
} from "@/lib/queue-service";
import { getDailyReport } from "@/lib/reports";
import { loadSessionData, projectConsole, projectDisplay, projectPatient } from "@/lib/snapshot";

afterAll(() => prisma.$disconnect());

async function makeTenant() {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Org ${tag}`, slug: `org-${tag}` } });
  const mk = (name: string) =>
    prisma.user.create({
      data: { name, email: `${name}-${tag}@phone.invalid`, role: "ASSISTANT", organizationId: org.id },
    });
  const user = await mk("a");
  const other = await mk("b");
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
  const ctx = (rid: string = randomUUID(), userId = user.id): QueueCtx => ({
    orgId: org.id,
    userId,
    sessionId: session.id,
    clientRequestId: rid,
  });
  return { org, user, other, doctor, session, ctx, today };
}

const tokens = (sessionId: string) =>
  prisma.token.findMany({ where: { sessionId }, orderBy: { serial: "asc" } });

describe("undo", () => {
  it("undoes 'next': the called patient waits again, the finished one is back inside, the session as before", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "A", phone: null }, { name: "B", phone: null }]);
    const first = await callNext(ctx(), null); // calls 1, session NOT_STARTED → RUNNING
    const [t1] = await tokens(session.id);
    const rid = randomUUID();
    await callNext(ctx(rid), t1.id); // 1 done, 2 called

    await undoAction(ctx(), rid);
    const [a, b] = await tokens(session.id);
    expect(a).toMatchObject({ status: "CALLED", completedAt: null });
    expect(b).toMatchObject({ status: "WAITING", calledAt: null });
    expect(first.calledSerial).toBe(1);

    const undos = await prisma.queueEvent.findMany({ where: { sessionId: session.id, action: "UNDO" } });
    expect(undos.map((e) => [e.fromStatus, e.toStatus]).sort()).toEqual([
      ["CALLED", "WAITING"],
      ["DONE", "CALLED"],
    ]);
    expect(undos.every((e) => (e.meta as { undoOf: string }).undoOf === rid)).toBe(true);
  });

  it("undoing the first call puts the session back to not started and clears the arrival time", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "A", phone: null }]);
    const rid = randomUUID();
    await callNext(ctx(rid), null);
    await undoAction(ctx(), rid);
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(s).toMatchObject({ status: "NOT_STARTED", doctorArrivedAt: null });
    expect((await tokens(session.id))[0].status).toBe("WAITING");
  });

  it("undoes skip / no-show / done", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "A", phone: null }, { name: "B", phone: null }]);
    await callNext(ctx(), null);
    const [a, b] = await tokens(session.id);

    const skip = randomUUID();
    await tokenAction(ctx(skip), b.id, "SKIP");
    await undoAction(ctx(), skip);
    expect((await tokens(session.id))[1].status).toBe("WAITING");

    const noShow = randomUUID();
    await tokenAction(ctx(noShow), a.id, "NO_SHOW");
    await undoAction(ctx(), noShow);
    expect((await tokens(session.id))[0].status).toBe("CALLED");

    const done = randomUUID();
    await tokenAction(ctx(done), a.id, "DONE");
    await undoAction(ctx(), done);
    expect((await tokens(session.id))[0]).toMatchObject({ status: "CALLED", completedAt: null });
  });

  it("refuses after any later change (no overwriting someone else's work), and can't be repeated", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "A", phone: null }]);
    const rid = randomUUID();
    await callNext(ctx(rid), null);
    await setDelay(ctx(), 10);
    await expect(undoAction(ctx(), rid)).rejects.toMatchObject({ code: "UNDO_STALE" });

    const rid2 = randomUUID();
    const [t] = await tokens(session.id);
    await tokenAction(ctx(rid2), t.id, "DONE");
    await undoAction(ctx(), rid2);
    await expect(undoAction(ctx(), rid2)).rejects.toMatchObject({ code: "UNDO_STALE" });
  });

  it("is idempotent by its own request id", async () => {
    const { session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "A", phone: null }]);
    const rid = randomUUID();
    await callNext(ctx(rid), null);
    const undoRid = randomUUID();
    const [r1, r2] = await Promise.all([undoAction(ctx(undoRid), rid), undoAction(ctx(undoRid), rid)]);
    expect(r2).toEqual(r1);
    expect(await prisma.queueEvent.count({ where: { sessionId: session.id, action: "UNDO" } })).toBe(2); // token + session, once
  });

  it("only the same user, only undoable actions, only within the window", async () => {
    const { session, other, ctx } = await makeTenant();
    const addRid = randomUUID();
    await addTokens(ctx(addRid), [{ name: "A", phone: null }]);
    await expect(undoAction(ctx(), addRid)).rejects.toMatchObject({ code: "INVALID" });

    const rid = randomUUID();
    await callNext(ctx(rid), null);
    await expect(undoAction(ctx(undefined, other.id), rid)).rejects.toMatchObject({ code: "INVALID" });

    await prisma.clientRequest.update({
      where: { id: rid },
      data: { createdAt: new Date(Date.now() - UNDO_WINDOW_MS - 1000) },
    });
    await expect(undoAction(ctx(), rid)).rejects.toMatchObject({ code: "UNDO_EXPIRED" });
    expect((await tokens(session.id))[0].status).toBe("CALLED");
  });

  it("cannot undo another organization's action", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await addTokens(a.ctx(), [{ name: "A", phone: null }]);
    const rid = randomUUID();
    await callNext(a.ctx(rid), null);
    await expect(
      undoAction({ ...b.ctx(), userId: a.user.id }, rid), // b's session, a's request
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("an undone out-of-order call is left out of the daily report", async () => {
    const { org, session, ctx, today } = await makeTenant();
    await addTokens(ctx(), [{ name: "A", phone: null }, { name: "B", phone: null }, { name: "C", phone: null }]);
    const [, , c] = await tokens(session.id);
    const rid = randomUUID();
    await callToken(ctx(rid), { tokenId: c.id, expectedCurrentTokenId: null, reason: "EMERGENCY" });
    expect((await getDailyReport(org.id, today)).outOfOrder).toHaveLength(1);
    await undoAction(ctx(), rid);
    const report = await getDailyReport(org.id, today);
    expect(report.outOfOrder).toHaveLength(0);
    expect(report.sessions[0].outOfOrder).toBe(0);
  });
});

describe("feature flags in the live views", () => {
  it("are off by default, follow the organization, and a doctor override wins", async () => {
    const { org, doctor, session, ctx } = await makeTenant();
    await addTokens(ctx(), [{ name: "A", phone: null }]);
    const code = (await tokens(session.id))[0].publicCode;

    let d = (await loadSessionData(session.id))!;
    expect(Object.values(d.features).some(Boolean)).toBe(false);

    await prisma.organization.update({
      where: { id: org.id },
      data: { features: { PATIENT_PROGRESS: true, DISPLAY_CHIME: true, CONSOLE_UNDO: true, CONSOLE_PWA: true } },
    });
    await prisma.doctor.update({ where: { id: doctor.id }, data: { features: { CONSOLE_UNDO: false, CONSOLE_PWA: false } } });
    d = (await loadSessionData(session.id))!;
    expect(projectPatient(d, code)!.features).toEqual({
      PATIENT_PROGRESS: true,
      PATIENT_ALERT: false,
      PATIENT_UPDATED_AGO: false,
    });
    expect(projectDisplay(d).features.DISPLAY_CHIME).toBe(true);
    expect(projectConsole(d).features.CONSOLE_UNDO).toBe(false); // doctor override
    expect(d.features.CONSOLE_PWA).toBe(true); // organization-only: the doctor can't turn it off
  });
});
