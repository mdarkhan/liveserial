import { describe, expect, it } from "vitest";
import {
  dhakaMonthRange,
  lateMinutes,
  smsLimitStatus,
  summarizeDay,
  summarizeSession,
  waitMinutes,
  type ReportToken,
} from "@/lib/reports";

const start = new Date("2026-11-10T11:00:00Z"); // 17:00 Dhaka
const at = (min: number) => new Date(start.getTime() + min * 60_000);
const tok = (p: Partial<ReportToken>): ReportToken => ({
  status: "DONE",
  createdAt: at(-300),
  calledAt: null,
  consultStartedAt: null,
  completedAt: null,
  ...p,
});

describe("waitMinutes", () => {
  it("counts from the scheduled start for serials booked earlier", () => {
    expect(waitMinutes(tok({ calledAt: at(40) }), start)).toBe(40);
  });
  it("counts from the serial's creation for walk-ins after the start", () => {
    expect(waitMinutes(tok({ createdAt: at(30), calledAt: at(45) }), start)).toBe(15);
  });
  it("is 0 when called before the scheduled start, null when never called", () => {
    expect(waitMinutes(tok({ calledAt: at(-10) }), start)).toBe(0);
    expect(waitMinutes(tok({}), start)).toBeNull();
  });
});

describe("lateMinutes", () => {
  it("is positive when late, negative when early, null when absent", () => {
    expect(lateMinutes(start, at(25))).toBe(25);
    expect(lateMinutes(start, at(-5))).toBe(-5);
    expect(lateMinutes(start, null)).toBeNull();
  });
});

describe("summarizeSession / summarizeDay", () => {
  const tokens: ReportToken[] = [
    tok({ calledAt: at(30), completedAt: at(40) }), // wait 30, consult 10
    tok({ calledAt: at(40), consultStartedAt: at(42), completedAt: at(50) }), // wait 40, consult 8
    tok({ calledAt: at(50), completedAt: at(50.2) }), // wait 50, mis-tap consult ignored
    tok({ status: "NO_SHOW" }),
    tok({ status: "CANCELLED" }),
    tok({ status: "WAITING" }),
  ];
  const s = summarizeSession({ scheduledStartAt: start, doctorArrivedAt: at(28) }, tokens);

  it("summarizes served patients only", () => {
    expect(s).toMatchObject({ booked: 5, served: 3, noShow: 1, avgWait: 40, avgConsult: 9, late: 28 });
  });

  it("weights the day by patient and counts early arrival as on time", () => {
    const other = summarizeSession({ scheduledStartAt: start, doctorArrivedAt: at(-10) }, [
      tok({ calledAt: at(0), completedAt: at(6) }),
    ]);
    const absent = summarizeSession({ scheduledStartAt: start, doctorArrivedAt: null }, []);
    expect(summarizeDay([s, other, absent])).toMatchObject({
      booked: 6,
      served: 4,
      avgWait: 30, // (30 + 40 + 50 + 0) / 4
      avgConsult: 8, // (10 + 8 + 6) / 3
      avgLate: 14, // (28 + 0) / 2; the absent doctor is not averaged
    });
  });
});

describe("dhakaMonthRange", () => {
  it("covers a Dhaka calendar month, including December to January", () => {
    expect(dhakaMonthRange("2026-11")).toEqual({
      from: new Date("2026-10-31T18:00:00Z"),
      to: new Date("2026-11-30T18:00:00Z"),
    });
    expect(dhakaMonthRange("2026-12").to).toEqual(new Date("2026-12-31T18:00:00Z"));
    expect(() => dhakaMonthRange("2026-13")).toThrow();
  });
});

describe("smsLimitStatus", () => {
  it("no limit → NONE; under 80% OK; from 80% NEAR; above the limit OVER", () => {
    expect(smsLimitStatus(5000, null)).toBe("NONE");
    expect(smsLimitStatus(5, 0)).toBe("NONE");
    expect(smsLimitStatus(79, 100)).toBe("OK");
    expect(smsLimitStatus(80, 100)).toBe("NEAR");
    expect(smsLimitStatus(100, 100)).toBe("NEAR");
    expect(smsLimitStatus(101, 100)).toBe("OVER");
  });
});
