/**
 * Optional features. The super admin switches each one on or off per
 * organization, and can override it per doctor ("same as organization" / on / off).
 * Everything is OFF unless switched on. Pure: used on the server and in tests.
 *
 * Stored as JSON on Organization.features and Doctor.features: { [key]: boolean }.
 * Unknown keys and non-boolean values are ignored.
 */

export const FEATURES = [
  // Patient page (/t/…)
  "PATIENT_PROGRESS",
  "PATIENT_ALERT",
  "PATIENT_UPDATED_AGO",
  // Waiting-room TV (/display/…)
  "DISPLAY_CHIME",
  "DISPLAY_ANNOUNCE",
  "DISPLAY_CONTROLS",
  // Assistant console
  "CONSOLE_UNDO",
  "CONSOLE_LOOKUP",
  "CONSOLE_PWA",
] as const;

export type Feature = (typeof FEATURES)[number];
export type FeatureFlags = Record<Feature, boolean>;
export type FeatureOverrides = Partial<Record<Feature, boolean>>;

/** Organization-wide only: installing the console isn't about one doctor. */
export const ORG_ONLY: readonly Feature[] = ["CONSOLE_PWA"];
export const DOCTOR_FEATURES: readonly Feature[] = FEATURES.filter((f) => !ORG_ONLY.includes(f));

export const FEATURE_GROUPS: ReadonlyArray<{ key: "patient" | "display" | "console"; features: readonly Feature[] }> = [
  { key: "patient", features: ["PATIENT_PROGRESS", "PATIENT_ALERT", "PATIENT_UPDATED_AGO"] },
  { key: "display", features: ["DISPLAY_CHIME", "DISPLAY_ANNOUNCE", "DISPLAY_CONTROLS"] },
  { key: "console", features: ["CONSOLE_UNDO", "CONSOLE_LOOKUP", "CONSOLE_PWA"] },
];

export function isFeature(k: string): k is Feature {
  return (FEATURES as readonly string[]).includes(k);
}

/** Reads a stored JSON value, keeping only known keys with boolean values. */
export function parseOverrides(json: unknown): FeatureOverrides {
  const out: FeatureOverrides = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (isFeature(k) && typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * Effective flags for a sitting: the doctor's override if set, otherwise the
 * organization's setting, otherwise off. Org-only features ignore the doctor.
 */
export function resolveFeatures(orgJson: unknown, doctorJson?: unknown): FeatureFlags {
  const org = parseOverrides(orgJson);
  const doc = parseOverrides(doctorJson);
  const out = {} as FeatureFlags;
  for (const f of FEATURES) {
    const d = ORG_ONLY.includes(f) ? undefined : doc[f];
    out[f] = d ?? org[f] ?? false;
  }
  return out;
}

/** Organization settings from a form: a checkbox per feature (present = on). */
export function orgFeaturesFromForm(fd: FormData): FeatureFlags {
  const out = {} as FeatureFlags;
  for (const f of FEATURES) out[f] = fd.get(f) === "on";
  return out;
}

/** Doctor overrides from a form: a select per feature, "inherit" | "on" | "off". */
export function doctorOverridesFromForm(fd: FormData): FeatureOverrides {
  const out: FeatureOverrides = {};
  for (const f of DOCTOR_FEATURES) {
    const v = fd.get(f);
    if (v === "on") out[f] = true;
    else if (v === "off") out[f] = false;
  }
  return out;
}
