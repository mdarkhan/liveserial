"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { LiveStatus } from "@/components/live-status";
import { cx } from "@/components/ui";
import { announceSerial } from "@/lib/announce";
import { bn, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { DisplayView } from "@/lib/snapshot";
import { playChime, unlockAudio } from "@/lib/sound";
import { useBreak } from "@/lib/use-break";
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
  const f = data.features;
  const wantsSound = f.DISPLAY_CHIME || f.DISPLAY_ANNOUNCE;
  const [soundOn, setSoundOn] = useState(false);
  const big = useBigMode(f.DISPLAY_CONTROLS);
  const fullscreen = useFullscreen();
  const timedBreak = useBreak(data.breakEndsAt, data.serverTime);

  // A newly called serial replays the pop animation (keyed by callCount)…
  const [callCount, setCallCount] = useState(0);
  const [shownServing, setShownServing] = useState(data.nowServing);
  if (data.nowServing !== shownServing) {
    setShownServing(data.nowServing);
    if (data.nowServing !== null && f.DISPLAY_CHIME) setCallCount((n) => n + 1);
  }
  // …and, if sound is on, chimes and announces it.
  const prevServing = useRef(data.nowServing);
  const speaking = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    const prev = prevServing.current;
    prevServing.current = data.nowServing;
    if (data.nowServing === null || data.nowServing === prev || !soundOn) return;
    const serial = data.nowServing;
    // One after another, so two quick calls don't talk over each other.
    speaking.current = speaking.current.then(async () => {
      if (f.DISPLAY_CHIME) await playChime();
      if (f.DISPLAY_ANNOUNCE) await announceSerial(serial, d.announce(bn(serial)));
    });
  }, [data.nowServing, f.DISPLAY_CHIME, f.DISPLAY_ANNOUNCE, soundOn]);

  const statusText =
    data.status === "CANCELLED"
      ? t.patient.sessionCancelled
      : data.status === "ENDED"
        ? t.patient.ended
        : data.status === "ON_BREAK"
          ? timedBreak && data.breakKind
            ? timedBreak.overdue
              ? t.patient.breakOverdue(t.patient.breakWhere[data.breakKind])
              : t.patient.breakTimed(t.patient.breakWhere[data.breakKind], timedBreak.time, timedBreak.left)
            : t.patient.onBreak
          : data.status === "NOT_STARTED"
            ? `${t.patient.doctorNotArrived} · ${t.patient.scheduledAt(formatTime(new Date(data.scheduledStartAt)))}`
            : null;

  return (
    <main id="main" tabIndex={-1} className="flex min-h-dvh flex-col bg-surface p-[3vmin] text-ink outline-none">
      <header className="flex items-start justify-between gap-4 border-b-2 border-line pb-[2vmin]">
        <div className="min-w-0">
          <h1 className="truncate text-[5vmin] font-bold leading-tight">{data.doctorName}</h1>
          <p className="truncate text-[max(15px,3vmin)] text-ink-muted">{data.chamberName}</p>
        </div>
        <p className="tabular shrink-0 text-[4.5vmin] font-semibold text-ink-muted">{clock}</p>
      </header>

      {statusText && (
        <p className="mt-[2vmin] rounded-xl border-2 border-warning/40 bg-warning-soft px-[2vmin] py-[1.5vmin] text-center text-[max(16px,4vmin)] font-semibold text-warning-ink">
          {statusText}
        </p>
      )}

      <div className={cx("grid flex-1 grid-cols-1 gap-[3vmin] py-[3vmin]", !big.on && "landscape:grid-cols-[3fr_2fr]")}>
        <section
          key={`now-${callCount}`}
          aria-label={d.nowServing}
          className={cx(
            "flex flex-col items-center justify-center rounded-[3vmin] bg-primary p-[2vmin] text-on-primary",
            callCount > 0 && "panel-flash",
          )}
        >
          <h2 className={cx("font-semibold", big.on ? "text-[7vmin]" : "text-[6vmin]")}>{d.nowServing}</h2>
          <p
            className={cx(
              "tabular font-bold leading-none",
              big.on ? "text-[36vmin]" : "text-[32vmin]",
              callCount > 0 && "serial-pop",
            )}
            aria-live="polite"
          >
            {data.nowServing !== null ? bn(data.nowServing) : "—"}
          </p>
        </section>

        {big.on ? (
          <section
            aria-label={d.next}
            className="rounded-[3vmin] border-2 border-line bg-canvas px-[3vmin] py-[1.5vmin] text-center"
          >
            <p className="tabular text-[7.5vmin] font-bold leading-tight">
              <span className="text-[6vmin] font-semibold text-ink-muted">{d.next}: </span>
              {data.next.length === 0 ? d.noneWaiting : data.next.map((n) => bn(n)).join(" · ")}
            </p>
          </section>
        ) : (
          <section aria-label={d.next} className="flex flex-col rounded-[3vmin] border-2 border-line bg-canvas p-[2vmin]">
            <h2 className="text-center text-[5vmin] font-semibold text-ink-muted">{d.next}</h2>
            {data.next.length === 0 ? (
              <p className="flex flex-1 items-center justify-center text-center text-[max(16px,4vmin)] text-ink-muted">
                {d.noneWaiting}
              </p>
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
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-[1.5vmin] text-[max(14px,2.2vmin)] text-ink-muted">
        <LiveStatus mode={mode} updatedAt={updatedAt} className="justify-start" />
        {(wantsSound || f.DISPLAY_CONTROLS) && (
          <div className="flex flex-wrap items-center gap-2">
            {wantsSound &&
              (soundOn ? (
                <ControlButton onClick={() => setSoundOn(false)} pressed>
                  {d.soundIsOn}
                </ControlButton>
              ) : (
                <ControlButton
                  onClick={async () => {
                    await unlockAudio();
                    setSoundOn(true);
                  }}
                  attention
                  title={d.soundOnHint}
                >
                  {d.soundOn}
                </ControlButton>
              ))}
            {f.DISPLAY_CONTROLS && (
              <>
                <ControlButton onClick={big.toggle} pressed={big.on}>
                  {big.on ? d.normalMode : d.bigMode}
                </ControlButton>
                {fullscreen.supported && (
                  <ControlButton onClick={fullscreen.toggle}>
                    {fullscreen.on ? d.exitFullscreen : d.fullscreen}
                  </ControlButton>
                )}
              </>
            )}
          </div>
        )}
      </footer>
    </main>
  );
}

function ControlButton({
  onClick,
  pressed,
  attention,
  title,
  children,
}: {
  onClick: () => void;
  pressed?: boolean;
  attention?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      title={title}
      className={cx(
        "min-h-12 rounded-lg border-2 px-4 text-base font-semibold",
        attention
          ? "animate-pulse border-primary bg-primary text-on-primary motion-reduce:animate-none"
          : pressed
            ? "border-primary bg-primary-soft text-primary"
            : "border-line-strong bg-surface text-ink hover:bg-canvas",
      )}
    >
      {children}
    </button>
  );
}

const BIG_KEY = "ls-display-big";
const BIG_EVENT = "ls-display-big-change";

function readBig(): boolean {
  try {
    return localStorage.getItem(BIG_KEY) === "1";
  } catch {
    return false; // storage blocked: normal size
  }
}

function subscribeBig(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(BIG_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(BIG_EVENT, onChange);
  };
}

/** "Big numbers" mode for a large room; remembered on this TV. */
function useBigMode(allowed: boolean) {
  const on = useSyncExternalStore(subscribeBig, readBig, () => false);
  const toggle = useCallback(() => {
    try {
      localStorage.setItem(BIG_KEY, readBig() ? "0" : "1");
    } catch {
      /* storage blocked: nothing to remember */
    }
    window.dispatchEvent(new Event(BIG_EVENT));
  }, []);
  return { on: allowed && on, toggle };
}

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function useFullscreen() {
  const on = useSyncExternalStore(subscribeFullscreen, () => !!document.fullscreenElement, () => false);
  const supported = useSyncExternalStore(
    subscribeFullscreen,
    () => typeof document.documentElement.requestFullscreen === "function",
    () => false,
  );
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);
  return { on, supported, toggle };
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
