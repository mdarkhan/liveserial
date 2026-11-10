import { describe, expect, it } from "vitest";
import { consultMinutes, projectConsole, projectDisplay, projectPatient, type SessionData } from "@/lib/snapshot";
import type { SessionStatus, TokenStatus } from "@/generated/prisma/enums";
import { resolveFeatures, type FeatureOverrides } from "@/lib/features";

function session(
  statuses: TokenStatus[],
  over: Partial<{ status: SessionStatus; threshold: number; features: FeatureOverrides }> = {},
): SessionData {
  return {
    id: "s1",
    organizationId: "o1",
    doctorId: "d1",
    chamberId: "c1",
    scheduleTemplateId: null,
    date: new Date("2026-11-10T00:00:00Z"),
    scheduledStartAt: new Date("2026-11-10T11:00:00Z"),
    status: over.status ?? "RUNNING",
    announcedDelayMinutes: null,
    doctorArrivedAt: new Date("2026-11-10T11:20:00Z"),
    endedAt: null,
    nextSerial: statuses.length + 1,
    queueVersion: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
    organization: { features: over.features ?? {} },
    doctor: { name: "ডা. করিম", features: {} },
    features: resolveFeatures(over.features ?? {}),
    chamber: { name: "চেম্বার ১", leaveNowThreshold: over.threshold ?? 3 },
    stats: { medianConsultMinutes: null, medianArrivalDelayMinutes: null },
    tokens: statuses.map((status, i) => ({
      id: `t${i + 1}`,
      serial: i + 1,
      queueOrder: i + 1,
      status,
      patientName: `SECRET-NAME-${i + 1}`,
      patientPhone: `880171100000${i}`,
      isEmergency: false,
      publicCode: `code${i + 1}xxxxx`,
      calledAt: null,
      consultStartedAt: null,
      completedAt: null,
    })),
  };
}

const queue: TokenStatus[] = ["DONE", "IN_CONSULT", "WAITING", "WAITING", "WAITING", "WAITING", "WAITING", "SKIPPED"];

describe("projectPatient", () => {
  it("never leaks other patients' names or any phone numbers", () => {
    const json = JSON.stringify(projectPatient(session(queue), "code5xxxxx"));
    expect(json).not.toMatch(/SECRET-NAME/);
    expect(json).not.toMatch(/8801711/);
    expect(json).not.toMatch(/code[0-9]/); // nor other patients' links
  });

  it("shows now serving and people ahead (counting the patient inside)", () => {
    const v = projectPatient(session(queue), "code5xxxxx")!;
    expect(v.nowServing).toBe(2);
    expect(v.you).toMatchObject({ serial: 5, status: "WAITING", peopleAhead: 3 });
  });

  it("gives an ETA range for a waiting patient (default 6 min × people ahead)", () => {
    // 3 ahead × 6 min = 18 → 15–25
    expect(projectPatient(session(queue), "code5xxxxx")!.you.eta).toEqual({ low: 15, high: 25, doctorArrived: true });
    expect(projectPatient(session(queue), "code2xxxxx")!.you.eta).toBeNull();
  });

  it("raises 'leave now' at the chamber threshold", () => {
    expect(projectPatient(session(queue, { threshold: 3 }), "code5xxxxx")!.you.leaveNow).toBe(true);
    expect(projectPatient(session(queue, { threshold: 2 }), "code5xxxxx")!.you.leaveNow).toBe(false);
  });

  it("has no queue position once called, done or away", () => {
    for (const code of ["code2xxxxx", "code1xxxxx", "code8xxxxx"]) {
      expect(projectPatient(session(queue), code)!.you).toMatchObject({ peopleAhead: null, leaveNow: false });
    }
  });

  it("has no queue position when the session has ended", () => {
    const v = projectPatient(session(queue, { status: "ENDED" }), "code5xxxxx")!;
    expect(v.you.peopleAhead).toBeNull();
    expect(v.you.leaveNow).toBe(false);
  });

  it("returns null for an unknown code", () => {
    expect(projectPatient(session(queue), "nope")).toBeNull();
  });
});

describe("projectDisplay", () => {
  it("shows now serving + next three serials, without names or phones", () => {
    const v = projectDisplay(session(queue));
    expect(v.nowServing).toBe(2);
    expect(v.next).toEqual([3, 4, 5]);
    expect(JSON.stringify(v)).not.toMatch(/SECRET-NAME|8801711|code\d/);
  });
});

describe("projectConsole", () => {
  it("lists current, waiting in order, away, and counts", () => {
    const v = projectConsole(session(queue));
    expect(v.current?.serial).toBe(2);
    expect(v.waiting.map((t) => t.serial)).toEqual([3, 4, 5, 6, 7]);
    expect(v.away.map((t) => t.serial)).toEqual([8]);
    expect(v.doneCount).toBe(1);
    expect(v.session.queueVersion).toBe(7);
  });
});

describe("consultMinutes", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 10, 11, 0, s));
  it("measures from entering, else from being called", () => {
    expect(consultMinutes({ calledAt: at(0), consultStartedAt: at(60), completedAt: at(420) })).toBe(6);
    expect(consultMinutes({ calledAt: at(0), consultStartedAt: null, completedAt: at(300) })).toBe(5);
  });
  it("ignores mis-taps under a minute and missing times", () => {
    expect(consultMinutes({ calledAt: at(0), consultStartedAt: null, completedAt: at(20) })).toBeNull();
    expect(consultMinutes({ calledAt: null, consultStartedAt: null, completedAt: at(20) })).toBeNull();
  });
});

describe("optional features in the views", () => {
  it("are all off unless switched on", () => {
    const d = session(queue);
    expect(projectPatient(d, "code5xxxxx")!.features).toEqual({
      PATIENT_PROGRESS: false,
      PATIENT_ALERT: false,
      PATIENT_UPDATED_AGO: false,
    });
    expect(projectConsole(d).features).toEqual({ CONSOLE_UNDO: false, CONSOLE_LOOKUP: false });
  });

  it("each view carries only its own flags", () => {
    const d = session(queue, { features: { PATIENT_ALERT: true, DISPLAY_ANNOUNCE: true, CONSOLE_LOOKUP: true } });
    expect(projectPatient(d, "code5xxxxx")!.features.PATIENT_ALERT).toBe(true);
    expect(projectDisplay(d).features).toEqual({ DISPLAY_CHIME: false, DISPLAY_ANNOUNCE: true, DISPLAY_CONTROLS: false });
    expect(Object.keys(projectPatient(d, "code5xxxxx")!.features)).not.toContain("CONSOLE_LOOKUP");
  });

  it("gives the patient a count of patients already seen (for the progress bar)", () => {
    expect(projectPatient(session(queue), "code5xxxxx")!.doneCount).toBe(1);
  });
});
