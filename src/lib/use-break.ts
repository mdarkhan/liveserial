"use client";

import { useEffect, useState } from "react";
import { bn, formatTime } from "@/lib/format";

export type BreakState = {
  /** Expected return, e.g. "রাত ৮:১৫". */
  time: string;
  /** Whole minutes left, rounded up (≥ 1 while running). */
  left: string;
  overdue: boolean;
};

/**
 * Countdown for a timed doctor break. Starts from the server's time so the first
 * render matches the server; then re-reads the clock every 15 s.
 */
export function useBreak(breakEndsAt: string | null, serverTime: string): BreakState | null {
  const [now, setNow] = useState(() => Date.parse(serverTime));
  useEffect(() => {
    if (!breakEndsAt) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [breakEndsAt]);
  if (!breakEndsAt) return null;
  const ends = Date.parse(breakEndsAt);
  const ms = ends - Math.max(now, Date.parse(serverTime));
  return {
    time: formatTime(new Date(ends)),
    left: bn(Math.max(1, Math.ceil(ms / 60_000))),
    overdue: ms <= 0,
  };
}
