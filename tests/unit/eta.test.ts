import { describe, expect, it } from "vitest";
import { computeEta, DEFAULT_MINUTES_PER_CONSULT, etaRange, median, minutesPerConsult, type EtaInput } from "@/lib/eta";

const NOW = new Date("2026-11-10T11:00:00Z"); // 17:00 Dhaka
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

const base: EtaInput = {
  now: NOW,
  peopleAhead: 5,
  scheduledStartAt: min(0),
  doctorArrivedAt: min(-10),
  announcedDelayMinutes: null,
  sessionConsultMinutes: [],
  doctorMedianConsultMinutes: null,
  doctorMedianArrivalDelayMinutes: null,
};

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([5, 1, 9])).toBe(5);
    expect(median([4, 8, 2, 6])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe("minutes per consultation", () => {
  it("uses this session's median once there are 3+ completed", () => {
    expect(minutesPerConsult([4, 10, 8], 20)).toEqual({ minutes: 8, source: "SESSION" });
  });
  it("only looks at the last 10 in this session", () => {
    const old = Array(20).fill(30);
    expect(minutesPerConsult([...old, ...Array(10).fill(5)], null).minutes).toBe(5);
  });
  it("falls back to the doctor's history with fewer than 3", () => {
    expect(minutesPerConsult([4, 10], 7)).toEqual({ minutes: 7, source: "DOCTOR_HISTORY" });
  });
  it("falls back to 6 minutes without any history", () => {
    expect(minutesPerConsult([4], null)).toEqual({ minutes: DEFAULT_MINUTES_PER_CONSULT, source: "DEFAULT" });
    expect(minutesPerConsult([], 0)).toEqual({ minutes: 6, source: "DEFAULT" });
  });
});

describe("etaRange", () => {
  it("rounds to 5 minutes and widens to 1.3×", () => {
    expect(etaRange(32)).toEqual({ low: 30, high: 45 });
    expect(etaRange(60)).toEqual({ low: 60, high: 80 });
  });
  it("is at least 10 minutes wide", () => {
    expect(etaRange(10)).toEqual({ low: 10, high: 20 });
    expect(etaRange(6)).toEqual({ low: 5, high: 15 });
  });
  it("says 'any moment' under 5 minutes", () => {
    expect(etaRange(0)).toEqual({ low: 0, high: 0 });
    expect(etaRange(4.9)).toEqual({ low: 0, high: 0 });
  });
});

describe("computeEta — doctor arrived", () => {
  it("is people ahead × minutes per consultation", () => {
    const e = computeEta({ ...base, sessionConsultMinutes: [6, 8, 10] });
    expect(e.doctorArrived).toBe(true);
    expect(e.minutes).toBe(40);
    expect([e.low, e.high]).toEqual([40, 55]);
    expect(e.expectedStartAt).toBeNull();
  });
  it("ignores the schedule and delays once arrived", () => {
    const e = computeEta({ ...base, scheduledStartAt: min(60), announcedDelayMinutes: 30 });
    expect(e.minutes).toBe(5 * 6);
  });
  it("is 'any moment' with nobody ahead", () => {
    const e = computeEta({ ...base, peopleAhead: 0 });
    expect([e.low, e.high]).toEqual([0, 0]);
  });
});

describe("computeEta — doctor not arrived", () => {
  const notArrived = { ...base, doctorArrivedAt: null };

  it("waits for the scheduled start when it's in the future", () => {
    const e = computeEta({ ...notArrived, scheduledStartAt: min(20), peopleAhead: 2 });
    expect(e.delaySource).toBe("NONE");
    expect(e.expectedStartAt).toEqual(min(20));
    expect(e.minutes).toBe(20 + 12);
  });

  it("adds the doctor's median arrival delay", () => {
    const e = computeEta({ ...notArrived, scheduledStartAt: min(10), doctorMedianArrivalDelayMinutes: 25, peopleAhead: 1 });
    expect(e.delaySource).toBe("DOCTOR_HISTORY");
    expect(e.minutes).toBe(35 + 6);
  });

  it("prefers an announced delay over history", () => {
    const e = computeEta({
      ...notArrived,
      scheduledStartAt: min(0),
      announcedDelayMinutes: 45,
      doctorMedianArrivalDelayMinutes: 10,
      peopleAhead: 0,
    });
    expect(e.delaySource).toBe("ANNOUNCED");
    expect(e.minutes).toBe(45);
    expect([e.low, e.high]).toEqual([45, 60]);
  });

  it("uses now when the expected start has already passed", () => {
    const e = computeEta({ ...notArrived, scheduledStartAt: min(-60), doctorMedianArrivalDelayMinutes: 15, peopleAhead: 3 });
    expect(e.expectedStartAt).toEqual(NOW);
    expect(e.minutes).toBe(18);
  });

  it("handles doctors who usually come early (negative delay)", () => {
    const e = computeEta({ ...notArrived, scheduledStartAt: min(30), doctorMedianArrivalDelayMinutes: -10, peopleAhead: 0 });
    expect(e.minutes).toBe(20);
  });

  it("combines with history-based minutes per consultation", () => {
    const e = computeEta({ ...notArrived, scheduledStartAt: min(0), doctorMedianConsultMinutes: 9, peopleAhead: 4 });
    expect(e.minutesSource).toBe("DOCTOR_HISTORY");
    expect(e.minutes).toBe(36);
  });

  it("never goes negative for odd inputs", () => {
    const e = computeEta({ ...notArrived, peopleAhead: -3 });
    expect(e.minutes).toBe(0);
  });
});
