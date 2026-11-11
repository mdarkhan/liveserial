import { describe, expect, it } from "vitest";
import { csvCell, dhakaHHmm, outOfOrderCsv, sessionsCsv, toCsv } from "@/lib/csv";
import { parsePeriod, periodRange, weekStart } from "@/lib/report-period";
import { daysBetween, type RangeReport } from "@/lib/reports";

const TODAY = "2026-11-11"; // a Wednesday

describe("periods", () => {
  it("parses only known periods (default: day)", () => {
    expect(parsePeriod("week")).toBe("week");
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("year")).toBe("day");
    expect(parsePeriod(undefined)).toBe("day");
  });

  it("weeks start on Saturday", () => {
    expect(weekStart("2026-11-07")).toBe("2026-11-07"); // Saturday
    expect(weekStart("2026-11-11")).toBe("2026-11-07"); // Wednesday
    expect(weekStart("2026-11-13")).toBe("2026-11-07"); // Friday
    expect(weekStart("2026-11-14")).toBe("2026-11-14"); // next Saturday
  });

  it("day: the date itself; no next day past today", () => {
    expect(periodRange("day", "2026-11-10", TODAY)).toMatchObject({
      from: "2026-11-10",
      to: "2026-11-10",
      prev: "2026-11-09",
      next: "2026-11-11",
    });
    expect(periodRange("day", TODAY, TODAY).next).toBeNull();
  });

  it("week: Saturday to Friday, cut at today; previous / next weeks", () => {
    expect(periodRange("week", "2026-11-11", TODAY)).toMatchObject({
      from: "2026-11-07",
      to: "2026-11-11",
      anchor: "2026-11-07",
      prev: "2026-10-31",
      next: null,
    });
    expect(periodRange("week", "2026-11-03", TODAY)).toMatchObject({
      from: "2026-10-31",
      to: "2026-11-06",
      next: "2026-11-07",
    });
  });

  it("month: the calendar month, cut at today; across a year boundary", () => {
    expect(periodRange("month", "2026-11", TODAY)).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-11",
      prev: "2026-10",
      next: null,
    });
    expect(periodRange("month", "2026-02", TODAY)).toMatchObject({ from: "2026-02-01", to: "2026-02-28", next: "2026-03" });
    expect(periodRange("month", "2026-01", TODAY).prev).toBe("2025-12");
    expect(periodRange("month", "2025-12", TODAY).next).toBe("2026-01");
  });

  it("falls back to today / this month for bad or future anchors", () => {
    expect(periodRange("day", "2026-02-30", TODAY).from).toBe(TODAY);
    expect(periodRange("day", "2027-01-01", TODAY).from).toBe(TODAY);
    expect(periodRange("day", "<script>", TODAY).from).toBe(TODAY);
    expect(periodRange("month", "2027-01", TODAY).from).toBe("2026-11-01");
    expect(periodRange("month", "2026-13", TODAY).from).toBe("2026-11-01");
  });

  it("lists every day of a range", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(daysBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
  });

  it("never lets a spreadsheet run typed text as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+88017")).toBe("'+88017");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell(-5)).toBe("-5"); // real numbers stay numbers
  });

  it("starts with a byte-order mark and uses CRLF (Excel opens Bangla correctly)", () => {
    const out = toCsv([["তারিখ", "রোগী"], ["2026-11-10", "রহিম"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe("﻿তারিখ,রোগী\r\n2026-11-10,রহিম\r\n");
  });

  it("prints Dhaka time in 24 h", () => {
    expect(dhakaHHmm(new Date("2026-11-10T11:30:00Z"))).toBe("17:30");
    expect(dhakaHHmm(new Date("2026-11-10T18:05:00Z"))).toBe("00:05");
  });

  const report: RangeReport = {
    from: "2026-11-10",
    to: "2026-11-10",
    days: [],
    doctors: [],
    totals: { booked: 0, served: 0, noShow: 0, avgWait: null, avgConsult: null, avgLate: null },
    sessions: [
      {
        id: "s1",
        date: "2026-11-10",
        doctorId: "d1",
        doctorName: "ডা. করিম",
        chamberName: "চেম্বার ১",
        scheduledStartAt: new Date("2026-11-10T11:00:00Z"),
        status: "ENDED",
        summary: { booked: 10, served: 8, noShow: 1, avgWait: 25, avgConsult: 6, late: -5, waits: [], consults: [] },
        outOfOrder: 2,
      },
    ],
    outOfOrder: [
      {
        id: "1",
        at: new Date("2026-11-10T12:15:00Z"),
        doctorName: "ডা. করিম",
        serial: 7,
        patientName: "=evil()",
        actorName: null,
        reason: "EMERGENCY",
        note: "বুকে ব্যথা, জরুরি",
        jumpedSerials: [5, 6],
      },
    ],
  };

  it("sessions CSV: one row per sitting with Bangla headers; early arrival counts as 0 late", () => {
    const lines = sessionsCsv(report).replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].split(",")[0]).toBe("তারিখ");
    expect(lines[1]).toBe("2026-11-10,17:00,ডা. করিম,চেম্বার ১,শেষ,10,8,1,25,6,0,2");
  });

  it("out-of-order CSV: reason, note, jumped serials; names are made safe", () => {
    const lines = outOfOrderCsv(report).replace("﻿", "").trim().split("\r\n");
    expect(lines[1]).toBe('2026-11-10,18:15,ডা. করিম,7,\'=evil(),জরুরি,"বুকে ব্যথা, জরুরি",5 6,সিস্টেম');
  });
});
