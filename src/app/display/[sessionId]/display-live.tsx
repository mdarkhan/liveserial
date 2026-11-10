"use client";

import { useEffect, useState } from "react";
import { LiveStatus } from "@/components/live-status";
import { bn, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { DisplayView } from "@/lib/snapshot";
import { useLive } from "@/lib/use-live";

const d = t.display;

export function DisplayLive({ sessionId, initial }: { sessionId: string; initial: DisplayView }) {
  const { data, mode, updatedAt } = useLive<DisplayView>(
    `/api/live/session/${sessionId}?view=display`,
    initial,
    (v) => v.v,
    Date.parse(initial.serverTime),
  );
  useWakeLock();
  const clock = useClock(Date.parse(initial.serverTime));

  const statusText =
    data.status === "CANCELLED"
      ? t.patient.sessionCancelled
      : data.status === "ENDED"
        ? t.patient.ended
        : data.status === "ON_BREAK"
          ? t.patient.onBreak
          : data.status === "NOT_STARTED"
            ? `${t.patient.doctorNotArrived} · ${t.patient.scheduledAt(formatTime(new Date(data.scheduledStartAt)))}`
            : null;

  return (
    <main className="flex min-h-dvh flex-col bg-surface p-[3vmin] text-ink">
      <header className="flex items-start justify-between gap-4 border-b-2 border-line pb-[2vmin]">
        <div className="min-w-0">
          <h1 className="truncate text-[5vmin] font-bold leading-tight">{data.doctorName}</h1>
          <p className="truncate text-[3vmin] text-ink-muted">{data.chamberName}</p>
        </div>
        <p className="tabular shrink-0 text-[4.5vmin] font-semibold text-ink-muted">{clock}</p>
      </header>

      {statusText && (
        <p className="mt-[2vmin] rounded-xl border-2 border-warning/40 bg-warning-soft px-[2vmin] py-[1.5vmin] text-center text-[4vmin] font-semibold text-warning-ink">
          {statusText}
        </p>
      )}

      <div className="grid flex-1 grid-cols-1 gap-[3vmin] py-[3vmin] landscape:grid-cols-[3fr_2fr]">
        <section
          aria-label={d.nowServing}
          className="flex flex-col items-center justify-center rounded-[3vmin] bg-primary p-[2vmin] text-white"
        >
          <h2 className="text-[6vmin] font-semibold">{d.nowServing}</h2>
          <p className="tabular text-[32vmin] font-bold leading-none" aria-live="polite">
            {data.nowServing !== null ? bn(data.nowServing) : "—"}
          </p>
        </section>

        <section aria-label={d.next} className="flex flex-col rounded-[3vmin] border-2 border-line bg-canvas p-[2vmin]">
          <h2 className="text-center text-[5vmin] font-semibold text-ink-muted">{d.next}</h2>
          {data.next.length === 0 ? (
            <p className="flex flex-1 items-center justify-center text-center text-[4vmin] text-ink-muted">{d.noneWaiting}</p>
          ) : (
            <ol className="flex flex-1 flex-col justify-around">
              {data.next.map((n) => (
                <li key={n} className="tabular text-center text-[12vmin] font-bold leading-none text-ink">
                  {bn(n)}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <footer className="text-[2.2vmin] text-ink-muted">
        <LiveStatus mode={mode} updatedAt={updatedAt} />
      </footer>
    </main>
  );
}

/** Keep a TV/tablet screen on while the page is visible (where the browser supports it). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (document.visibilityState === "visible" && nav.wakeLock) lock = await nav.wakeLock.request("screen");
      } catch {
        /* not allowed / unsupported: fine */
      }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/** Wall clock, starting from the server's time so the first render matches. */
function useClock(start: number): string {
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  return formatTime(new Date(now));
}
