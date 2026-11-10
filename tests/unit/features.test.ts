import { describe, expect, it } from "vitest";
import {
  DOCTOR_FEATURES,
  doctorOverridesFromForm,
  FEATURE_GROUPS,
  FEATURES,
  orgFeaturesFromForm,
  parseOverrides,
  resolveFeatures,
} from "@/lib/features";

describe("resolveFeatures", () => {
  it("is all off for empty or broken settings", () => {
    for (const json of [{}, null, undefined, "x", [], { PATIENT_PROGRESS: "yes" }]) {
      expect(Object.values(resolveFeatures(json)).some(Boolean)).toBe(false);
    }
  });

  it("uses the organization's setting unless the doctor overrides it", () => {
    const f = resolveFeatures(
      { PATIENT_PROGRESS: true, DISPLAY_CHIME: true, CONSOLE_UNDO: false },
      { DISPLAY_CHIME: false, CONSOLE_UNDO: true },
    );
    expect(f.PATIENT_PROGRESS).toBe(true);
    expect(f.DISPLAY_CHIME).toBe(false);
    expect(f.CONSOLE_UNDO).toBe(true);
    expect(f.PATIENT_ALERT).toBe(false);
  });

  it("ignores doctor overrides of organization-only features", () => {
    expect(resolveFeatures({ CONSOLE_PWA: true }, { CONSOLE_PWA: false }).CONSOLE_PWA).toBe(true);
    expect(resolveFeatures({}, { CONSOLE_PWA: true }).CONSOLE_PWA).toBe(false);
  });

  it("drops unknown keys", () => {
    expect(parseOverrides({ NOPE: true, PATIENT_ALERT: false })).toEqual({ PATIENT_ALERT: false });
  });
});

describe("forms", () => {
  it("organization: a checked box is on, a missing one off", () => {
    const fd = new FormData();
    fd.set("PATIENT_ALERT", "on");
    const f = orgFeaturesFromForm(fd);
    expect(f.PATIENT_ALERT).toBe(true);
    expect(Object.values(f).filter(Boolean)).toHaveLength(1);
    expect(Object.keys(f)).toHaveLength(FEATURES.length);
  });

  it("doctor: inherit is stored as nothing, on/off as booleans, org-only keys ignored", () => {
    const fd = new FormData();
    fd.set("PATIENT_ALERT", "on");
    fd.set("DISPLAY_CHIME", "off");
    fd.set("CONSOLE_UNDO", "inherit");
    fd.set("CONSOLE_PWA", "on");
    expect(doctorOverridesFromForm(fd)).toEqual({ PATIENT_ALERT: true, DISPLAY_CHIME: false });
  });

  it("every feature is in exactly one group", () => {
    const all = FEATURE_GROUPS.flatMap((g) => g.features);
    expect([...all].sort()).toEqual([...FEATURES].sort());
    expect(DOCTOR_FEATURES).not.toContain("CONSOLE_PWA");
  });
});
