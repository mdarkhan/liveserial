import { describe, expect, it } from "vitest";
import {
  addDays,
  bn,
  dhakaDateString,
  dhakaWallTimeToUtc,
  displayPhone,
  formatTime,
  normalizeBdPhone,
  toAsciiDigits,
  weekdayOf,
} from "@/lib/format";
import { generatePublicCode } from "@/lib/queue";

describe("digits", () => {
  it("converts to Bangla digits and back", () => {
    expect(bn(1205)).toBe("১২০৫");
    expect(bn("সিরিয়াল 12")).toBe("সিরিয়াল ১২");
    expect(toAsciiDigits("০১৭১১-২৩৪৫৬৭")).toBe("01711-234567");
  });
});

describe("normalizeBdPhone", () => {
  it.each([
    ["01711000000", "8801711000000"],
    ["+8801711000000", "8801711000000"],
    ["8801711000000", "8801711000000"],
    ["01711-000 000", "8801711000000"],
    ["০১৯১২৩৪৫৬৭৮", "8801912345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it.each(["", "0171100000", "017110000000", "01211000000", "02-9876543", "abc"])("rejects %s", (input) => {
    expect(normalizeBdPhone(input)).toBeNull();
  });

  it("formats for display", () => {
    expect(displayPhone("8801711000000")).toBe("01711-000000");
    expect(displayPhone(null)).toBe("");
  });
});

describe("Dhaka time", () => {
  it("uses the Dhaka calendar date, not UTC", () => {
    // 2026-11-10 20:30 UTC is already 2026-11-11 02:30 in Dhaka.
    expect(dhakaDateString(new Date("2026-11-10T20:30:00Z"))).toBe("2026-11-11");
    expect(dhakaDateString(new Date("2026-11-10T17:59:00Z"))).toBe("2026-11-10");
  });

  it("converts Dhaka wall time to UTC", () => {
    expect(dhakaWallTimeToUtc("2026-11-10", "17:00").toISOString()).toBe("2026-11-10T11:00:00.000Z");
    expect(dhakaWallTimeToUtc("2026-11-10", "03:00").toISOString()).toBe("2026-11-09T21:00:00.000Z");
    expect(() => dhakaWallTimeToUtc("2026-11-10", "25:00")).toThrow();
  });

  it("formats Dhaka times with a Bangla time-of-day word", () => {
    expect(formatTime(new Date("2026-11-10T11:00:00Z"))).toBe("বিকাল ৫:০০");
    expect(formatTime(new Date("2026-11-10T03:05:00Z"))).toBe("সকাল ৯:০৫");
    expect(formatTime(new Date("2026-11-10T06:30:00Z"))).toBe("দুপুর ১২:৩০");
    expect(formatTime(new Date("2026-11-10T15:00:00Z"))).toBe("রাত ৯:০০");
    expect(formatTime(new Date("2026-11-10T18:00:00Z"))).toBe("রাত ১২:০০");
  });

  it("computes weekdays and adds days", () => {
    expect(weekdayOf("2026-11-10")).toBe(2); // Tuesday
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("generatePublicCode", () => {
  it("is 10 chars from the no-look-alike alphabet and unique enough", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generatePublicCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(/^[2-9a-hj-km-np-zA-HJ-NP-Z]{10}$/);
  });
});
