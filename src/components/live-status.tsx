"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { bn, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { LiveMode } from "@/lib/use-live";

/** Older than this (the server pings every 20 s) and the data may be out of date. */
const STALE_AFTER_MS = 60_000;

/**
 * "● লাইভ · সর্বশেষ আপডেট: রাত ১:৩২" — color is never the only signal.
 * `relative` shows "… সেকেন্ড আগে" instead of a clock time, and warns when stale.
 */
export function LiveStatus({
  mode,
  updatedAt,
  className,
  relative,
}: {
  mode: LiveMode;
  updatedAt: number;
  className?: string;
  relative?: boolean;
}) {
  const now = useNow(relative ? 5_000 : null, updatedAt);
  const age = Math.max(0, now - updatedAt);
  const stale = relative && age > STALE_AFTER_MS;
  return (
    <>
      <p className={cx("flex flex-wrap items-center justify-center gap-x-2", className)}>
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span
            aria-hidden="true"
            className={cx(
              "inline-block size-2.5 rounded-full",
              mode === "live" ? "bg-success" : mode === "polling" ? "bg-warning" : "animate-pulse bg-line-strong",
            )}
          />
          {mode === "live" ? t.live.live : mode === "polling" ? t.live.polling : t.live.connecting}
        </span>
        <span className={cx(stale && "font-semibold text-warning-ink")}>
          · {relative ? relativeText(age) : t.live.updatedAt(formatTime(new Date(updatedAt)))}
        </span>
      </p>
      {stale && (
        <p role="status" className="font-medium text-warning-ink">
          {t.live.stale}
        </p>
      )}
    </>
  );
}

function relativeText(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 10) return t.live.updatedJustNow;
  if (s < 60) return t.live.updatedSecondsAgo(bn(Math.floor(s / 5) * 5));
  return t.live.updatedMinutesAgo(bn(Math.floor(s / 60)));
}

/** Current time, re-read every `everyMs` (null = never). Starts at `start` so server and client render the same. */
function useNow(everyMs: number | null, start: number): number {
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!everyMs) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return Math.max(now, start);
}
