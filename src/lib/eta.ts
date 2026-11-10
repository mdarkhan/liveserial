/**
 * Wait-time estimate (pure). Rules from the brief:
 *  - Minutes per consultation = median of the last 10 completed consultations in
 *    this session; if fewer than 3, the doctor's median over their last 30
 *    sessions; if that doesn't exist either, 6 minutes.
 *  - Doctor arrived: ETA = people ahead × minutes per consultation.
 *  - Not arrived: start = later of (now, scheduled start + delay), where delay is
 *    the announced "running late by N" if set, else the doctor's median arrival
 *    delay over the last 30 sessions (else 0). ETA = (start − now) + ahead × mpc.
 *  - Shown as a range rounded to 5 minutes, never one exact number.
 */

export const DEFAULT_MINUTES_PER_CONSULT = 6;
export const SESSION_SAMPLE = 10;
export const MIN_SESSION_SAMPLES = 3;

export type EtaInput = {
  now: Date;
  peopleAhead: number;
  scheduledStartAt: Date;
  /** Null until the doctor is marked arrived (or the first patient is called). */
  doctorArrivedAt: Date | null;
  announcedDelayMinutes: number | null;
  /** Durations (minutes) of this session's completed consultations, oldest → newest. */
  sessionConsultMinutes: number[];
  /** Doctor's median consultation (minutes) over their last 30 sessions, if known. */
  doctorMedianConsultMinutes: number | null;
  /** Doctor's median arrival delay (minutes, may be negative) over their last 30 sessions, if known. */
  doctorMedianArrivalDelayMinutes: number | null;
  /** On a timed break: minutes until the doctor is expected back (added to the wait). */
  breakRemainingMinutes?: number | null;
};

export type MinutesSource = "SESSION" | "DOCTOR_HISTORY" | "DEFAULT";
export type DelaySource = "ANNOUNCED" | "DOCTOR_HISTORY" | "NONE";

export type Eta = {
  minutesPerConsult: number;
  minutesSource: MinutesSource;
  doctorArrived: boolean;
  /** When consultations are expected to (re)start; only when the doctor hasn't arrived. */
  expectedStartAt: Date | null;
  delaySource: DelaySource | null;
  /** Point estimate in minutes from now (internal; never shown alone). */
  minutes: number;
  /** Displayed range, rounded to 5 minutes. low = high = 0 means "any moment". */
  low: number;
  high: number;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function minutesPerConsult(
  sessionConsultMinutes: number[],
  doctorMedian: number | null,
): { minutes: number; source: MinutesSource } {
  const recent = sessionConsultMinutes.slice(-SESSION_SAMPLE);
  if (recent.length >= MIN_SESSION_SAMPLES) return { minutes: median(recent)!, source: "SESSION" };
  if (doctorMedian !== null && doctorMedian > 0) return { minutes: doctorMedian, source: "DOCTOR_HISTORY" };
  return { minutes: DEFAULT_MINUTES_PER_CONSULT, source: "DEFAULT" };
}

/**
 * Range around the estimate: low rounded down to 5, high = 1.3 × estimate rounded
 * up to 5, at least 10 minutes wide. Under 5 minutes → "any moment" (0–0).
 */
export function etaRange(minutes: number): { low: number; high: number } {
  if (minutes < 5) return { low: 0, high: 0 };
  const low = Math.floor(minutes / 5) * 5;
  const high = Math.max(Math.ceil((minutes * 1.3) / 5) * 5, low + 10);
  return { low, high };
}

export function computeEta(input: EtaInput): Eta {
  const mpc = minutesPerConsult(input.sessionConsultMinutes, input.doctorMedianConsultMinutes);
  const ahead = Math.max(0, input.peopleAhead);
  const consultMinutes = ahead * mpc.minutes;
  const breakMinutes = Math.max(0, input.breakRemainingMinutes ?? 0);

  if (input.doctorArrivedAt) {
    const minutes = consultMinutes + breakMinutes;
    return {
      minutesPerConsult: mpc.minutes,
      minutesSource: mpc.source,
      doctorArrived: true,
      expectedStartAt: null,
      delaySource: null,
      minutes,
      ...etaRange(minutes),
    };
  }

  let delay = 0;
  let delaySource: DelaySource = "NONE";
  if (input.announcedDelayMinutes !== null && input.announcedDelayMinutes > 0) {
    delay = input.announcedDelayMinutes;
    delaySource = "ANNOUNCED";
  } else if (input.doctorMedianArrivalDelayMinutes !== null) {
    delay = input.doctorMedianArrivalDelayMinutes;
    delaySource = "DOCTOR_HISTORY";
  }
  const expected = input.scheduledStartAt.getTime() + delay * 60_000;
  const start = Math.max(input.now.getTime(), expected);
  const minutes = (start - input.now.getTime()) / 60_000 + consultMinutes;
  return {
    minutesPerConsult: mpc.minutes,
    minutesSource: mpc.source,
    doctorArrived: false,
    expectedStartAt: new Date(start),
    delaySource,
    minutes,
    ...etaRange(minutes),
  };
}
