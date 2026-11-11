import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sessionsCsv } from "@/lib/csv";
import { prisma } from "@/lib/db";
import { addDays, dateOnly, dhakaWallTimeToUtc } from "@/lib/format";
import { getRangeReport } from "@/lib/reports";

afterAll(() => prisma.$disconnect());

/**
 * An organization with sittings on 3 days of a fixed past week (Sat 2026-10-31
 * … Fri 2026-11-06) for two doctors, plus one cancelled sitting.
 */
async function makeWeek() {
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Org ${tag}`, slug: `rng-${tag}` } });
  const [docA, docB] = await Promise.all([
    prisma.doctor.create({ data: { organizationId: org.id, name: "Dr. A" } }),
    prisma.doctor.create({ data: { organizationId: org.id, name: "Dr. B" } }),
  ]);
  const chamber = await prisma.chamber.create({ data: { organizationId: org.id, name: "Room" } });

  let serial = 0;
  async function sitting(date: string, doctorId: string, served: number, opts: { cancelled?: boolean; waitMin?: number } = {}) {
    const start = dhakaWallTimeToUtc(date, "17:00");
    const m = (min: number) => new Date(start.getTime() + min * 60_000);
    const s = await prisma.session.create({
      data: {
        organizationId: org.id,
        doctorId,
        chamberId: chamber.id,
        date: dateOnly(date),
        scheduledStartAt: start,
        status: opts.cancelled ? "CANCELLED" : "ENDED",
        doctorArrivedAt: opts.cancelled ? null : m(10),
      },
    });
    for (let i = 0; i < served; i++) {
      serial++;
      await prisma.token.create({
        data: {
          organizationId: org.id,
          sessionId: s.id,
          serial: i + 1,
          queueOrder: i + 1,
          patientName: `P${serial}`,
          publicCode: `rng${tag}${String(serial).padStart(3, "0")}`.slice(0, 16),
          status: "DONE",
          createdAt: m(-60),
          calledAt: m((opts.waitMin ?? 20) + i * 10),
          completedAt: m((opts.waitMin ?? 20) + i * 10 + 8),
        },
      });
    }
    // One no-show per sitting.
    await prisma.token.create({
      data: {
        organizationId: org.id,
        sessionId: s.id,
        serial: served + 1,
        queueOrder: served + 1,
        patientName: "Absent",
        publicCode: `rng${tag}x${String(serial++).padStart(3, "0")}`.slice(0, 16),
        status: "NO_SHOW",
        createdAt: m(-60),
      },
    });
    return s;
  }

  await sitting("2026-10-31", docA.id, 3); // Sat
  await sitting("2026-11-02", docA.id, 2); // Mon
  await sitting("2026-11-02", docB.id, 4, { waitMin: 40 });
  await sitting("2026-11-04", docB.id, 1, { cancelled: true }); // left out
  await sitting("2026-11-07", docA.id, 5); // next week: outside the range
  return { org, docA, docB };
}

describe("range report (week / month)", () => {
  it("adds up a week per day and per doctor, skipping cancelled sittings and other weeks", async () => {
    const { org, docA, docB } = await makeWeek();
    const r = await getRangeReport(org.id, "2026-10-31", "2026-11-06");

    expect(r.days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays("2026-10-31", i)));
    expect(r.days.map((d) => d.served)).toEqual([3, 0, 6, 0, 0, 0, 0]);
    expect(r.days.map((d) => d.sessions)).toEqual([1, 0, 2, 0, 0, 0, 0]);
    expect(r.days[1]).toMatchObject({ booked: 0, avgWait: null });

    expect(r.sessions).toHaveLength(3);
    expect(r.totals).toMatchObject({ served: 9, booked: 12, noShow: 3 });

    // Most patients first.
    expect(r.doctors.map((d) => [d.doctorId, d.served, d.sessions])).toEqual([
      [docA.id, 5, 2],
      [docB.id, 4, 1],
    ]);
    // Dr. B's waits: called at 40, 50, 60, 70 minutes after the start → average 55.
    expect(r.doctors[1].avgWait).toBe(55);
    // Doctor arrived 10 minutes late at every sitting.
    expect(r.totals.avgLate).toBe(10);
  });

  it("limits to one doctor for the doctor's own report", async () => {
    const { org, docA } = await makeWeek();
    const r = await getRangeReport(org.id, "2026-10-31", "2026-11-06", docA.id);
    expect(r.sessions.every((s) => s.doctorId === docA.id)).toBe(true);
    expect(r.totals.served).toBe(5);
    expect(r.doctors).toHaveLength(1);
  });

  it("is scoped to the organization", async () => {
    const a = await makeWeek();
    const b = await makeWeek();
    const r = await getRangeReport(a.org.id, "2026-10-01", "2026-11-30");
    expect(r.sessions.every((s) => s.doctorId === a.docA.id || s.doctorId === a.docB.id)).toBe(true);
    expect(r.sessions.some((s) => s.doctorId === b.docA.id)).toBe(false);
  });

  it("exports the sittings as CSV rows", async () => {
    const { org } = await makeWeek();
    const csv = sessionsCsv(await getRangeReport(org.id, "2026-10-31", "2026-11-06"));
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(4); // header + 3 sittings
    expect(lines[1].startsWith("2026-10-31,17:00,Dr. A,Room,")).toBe(true);
  });
});
