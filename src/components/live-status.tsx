"use client";

import { cx } from "@/components/ui";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { LiveMode } from "@/lib/use-live";

/** "● লাইভ · সর্বশেষ আপডেট: রাত ১:৩২" — color is never the only signal. */
export function LiveStatus({ mode, updatedAt, className }: { mode: LiveMode; updatedAt: number; className?: string }) {
  return (
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
      <span>· {t.live.updatedAt(formatTime(new Date(updatedAt)))}</span>
    </p>
  );
}
