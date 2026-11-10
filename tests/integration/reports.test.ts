import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dateOnly, dhakaDateString, dhakaWallTimeToUtc } from "@/lib/format";
import { addTokens, callNext, callToken, tokenAction, type QueueCtx } from "@/lib/queue-service";
import { getDailyReport, getSmsUsage } from "@/lib/reports";

afterAll(() => prisma.$disconnect());

/** A fresh org with two doctors sitting today; Dr. A has 4 patients. */
async function makeDay() {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Org ${tag}`, slug: `rep-${tag}` } });
  const user = await prisma.user.create({
    data: { name: "Assistant", email: `${tag}@phone.invalid`, role: "ASSISTANT", organizationId: org.id },
  });
  const [docA, docB] = await Promise.all([
    prisma.doctor.create({ data: { organizationId: org.id, name: "Dr. A" } }),
    prisma.doctor.create({ data: { organizationId: org.id, name: "Dr. B" } }),
  ]);
  const chamber = await prisma.chamber.create({ data: { organizationId: org.id, name: "Room" } });
  const date = dhakaDateString();
  const start = dhakaWallTimeToUtc(date, "17:00");
  const base = { organizationId: org.id, chamberId: chamber.id, date: dateOnly(date), scheduledStartAt: start };
  const session = await prisma.session.create({ data: { ...base, doctorId: docA.id } });
  await prisma.session.create({ data: { ...base, doctorId: docB.id } });
  const ctx = (): QueueCtx => ({ orgId: org.id, userId: user.id, sessionId: session.id, clientRequestId: randomUUID() });
  const added = await addTokens(
    ctx(),
    [1, 2, 3, 4].map((i) => ({ name: `P${i}`, phone: `88017110000${i}0` })),
  );
  return { org, docA, docB, session, ctx, added, date, start };
}

describe("daily report", () => {
  it("reports served, waits, consult time, lateness and out-of-order calls with reasons", async () => {
    const d = await makeDay();
    const id = (serial: number) => d.added.find((a) => a.serial === serial)!.id;

    await callNext(d.ctx(), null); // serial 1 called, doctor arrives
    await callToken(d.ctx(), {
      tokenId: id(3),
      expectedCurrentTokenId: id(1),
      reason: "REPORT_CHECK",
      note: "রিপোর্ট দেখাবেন",
    }); // 1 done, 3 called out of order (jumps 2)
    await tokenAction(d.ctx(), id(3), "DONE");

    // Real-world timings (the calls above happened within milliseconds).
    const m = (min: number) => new Date(d.start.getTime() + min * 60_000);
    await prisma.session.update({ where: { id: d.session.id }, data: { doctorArrivedAt: m(20) } });
    await prisma.token.updateMany({ where: { sessionId: d.session.id }, data: { createdAt: m(-120) } });
    await prisma.token.update({ where: { id: id(1) }, data: { calledAt: m(20), completedAt: m(30) } });
    await prisma.token.update({
      where: { id: id(3) },
      data: { calledAt: m(30), completedAt: m(36), consultStartedAt: null },
    });

    const report = await getDailyReport(d.org.id, d.date);
    expect(report.sessions).toHaveLength(2);
    const a = report.sessions.find((s) => s.doctorName === "Dr. A")!;
    expect(a.summary).toMatchObject({ booked: 4, served: 2, avgWait: 25, avgConsult: 8, late: 20 });
    expect(a.outOfOrder).toBe(1);
    expect(report.outOfOrder).toEqual([
      expect.objectContaining({
        doctorName: "Dr. A",
        serial: 3,
        patientName: "P3",
        reason: "REPORT_CHECK",
        note: "রিপোর্ট দেখাবেন",
        jumpedSerials: [2],
        actorName: "Assistant",
      }),
    ]);
    expect(report.totals).toMatchObject({ served: 2, booked: 4, avgLate: 20 });

    // A doctor's own report contains only their sittings.
    const own = await getDailyReport(d.org.id, d.date, d.docB.id);
    expect(own.sessions.map((s) => s.doctorName)).toEqual(["Dr. B"]);
    expect(own.outOfOrder).toEqual([]);
  });

  it("never shows another organization's sessions", async () => {
    const d = await makeDay();
    const other = await prisma.organization.create({
      data: { name: "Other", slug: `rep-o-${randomUUID().slice(0, 8)}` },
    });
    expect((await getDailyReport(other.id, d.date)).sessions).toEqual([]);
    // Passing another org's doctor id leaks nothing either.
    expect((await getDailyReport(other.id, d.date, d.docA.id)).sessions).toEqual([]);
  });
});

describe("SMS usage", () => {
  it("counts sent messages and billable segments per organization for the month", async () => {
    const d = await makeDay(); // 4 creation SMS queued
    const rows = await prisma.smsMessage.findMany({ where: { organizationId: d.org.id }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(4);
    await prisma.smsMessage.updateMany({
      where: { id: { in: rows.slice(0, 3).map((r) => r.id) } },
      data: { status: "SENT" },
    });
    await prisma.smsMessage.update({ where: { id: rows[3].id }, data: { status: "FAILED" } });

    const usage = await getSmsUsage(d.date.slice(0, 7));
    expect(usage.find((u) => u.orgId === d.org.id)).toMatchObject({
      sent: 3,
      sentSegments: rows.slice(0, 3).reduce((a, r) => a + r.segments, 0),
      failed: 1,
      pending: 0,
    });
    // A month without messages lists the org with zeros.
    expect((await getSmsUsage("2020-01")).find((u) => u.orgId === d.org.id)).toMatchObject({
      sent: 0,
      sentSegments: 0,
      failed: 0,
      pending: 0,
    });
  });
});
