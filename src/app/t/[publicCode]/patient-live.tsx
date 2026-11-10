"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { bn, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { PatientView } from "@/lib/snapshot";
import { useLive } from "@/lib/use-live";
import { LiveStatus } from "@/components/live-status";
import { newRequestId } from "@/lib/queue";
import { playAlert, unlockAudio } from "@/lib/sound";
import { useBreak } from "@/lib/use-break";

const p = t.patient;

/** Ahead ≤ this: "get ready" (page turns amber, then green at 1). */
const READY_AT = 3;
/** Ahead ≤ this: the alert sounds (once, when it gets there). */
const ALERT_AT = 2;

type Zone = "far" | "ready" | "next";

function zoneOf(view: PatientView): Zone {
  const a = view.you.peopleAhead;
  if (view.you.status !== "WAITING" || a === null) return "far";
  return a <= 1 ? "next" : a <= READY_AT ? "ready" : "far";
}

export function PatientLive({ code, initial }: { code: string; initial: PatientView }) {
  const { data, apply, mode, updatedAt } = useLive<PatientView>(
    `/api/live/t/${code}`,
    initial,
    (v) => v.v,
    Date.parse(initial.serverTime),
  );
  const s = data.session;
  const you = data.you;
  const scheduled = new Date(s.scheduledStartAt);
  const f = data.features;
  const zone = f.PATIENT_PROGRESS ? zoneOf(data) : "far";

  return (
    <div
      className={cx(
        "flex w-full flex-1 flex-col transition-colors duration-500",
        zone === "ready" && "bg-warning-soft",
        zone === "next" && "bg-success-soft",
      )}
    >
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-5">
        <header>
          <p className="text-sm font-semibold text-primary">{t.appName}</p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">{s.doctorName}</h1>
          <p className="text-ink-muted">
            {s.chamberName} · {formatDate(scheduled)}
          </p>
        </header>

        <SessionBanner view={data} />

        <YourStatus view={data} />

        {f.PATIENT_ALERT && <AlertToggle view={data} />}

        {f.PATIENT_NOT_COMING && <NotComing code={code} view={data} onView={apply} />}

        <footer className="space-y-1 pt-2 text-center text-sm text-ink-muted">
          <LiveStatus mode={mode} updatedAt={updatedAt} relative={f.PATIENT_UPDATED_AGO} />
          <p>{p.keepOpen}</p>
          <noscript>
            <a href="" className="font-medium text-primary underline">
              {t.live.reload}
            </a>
          </noscript>
        </footer>
        {/* Screen readers hear changes to the main numbers without the page moving focus. */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {data.nowServing !== null ? `${p.nowServing} ${bn(data.nowServing)}. ` : ""}
          {you.peopleAhead !== null ? p.ahead(bn(you.peopleAhead)) : ""}
        </p>
      </main>
    </div>
  );
}

/** Line progress: patients already seen vs. people still ahead of you. */
function Progress({ view }: { view: PatientView }) {
  const ahead = view.you.peopleAhead ?? 0;
  const done = view.doneCount;
  const total = done + ahead;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const zone = zoneOf(view);
  return (
    <section
      aria-label={p.progressLabel}
      className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4"
    >
      <h2 className="mb-2 text-sm font-semibold text-ink-muted">{p.progressLabel}</h2>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={p.progressDetail(bn(done), bn(ahead))}
        className="h-5 overflow-hidden rounded-full bg-canvas ring-1 ring-line"
      >
        <div
          className={cx(
            "h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none",
            zone === "next" ? "bg-success" : zone === "ready" ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
      <p className="tabular mt-2 text-center font-medium">{p.progressDetail(bn(done), bn(ahead))}</p>
    </section>
  );
}

/**
 * Sound + vibration when the turn is near (ahead ≤ 2) and when called.
 * Browsers only allow sound after a tap, so the patient switches it on here;
 * it lasts while the page stays open.
 */
function AlertToggle({ view }: { view: PatientView }) {
  const [on, setOn] = useState(false);
  const prev = useRef<{ ahead: number | null; called: boolean } | null>(null);
  const called = view.you.status === "CALLED" || view.you.status === "IN_CONSULT";
  const ahead = view.you.peopleAhead;

  useEffect(() => {
    const before = prev.current;
    prev.current = { ahead, called };
    if (!on || !before) return;
    if (called && !before.called) playAlert(true);
    else if (ahead !== null && ahead <= ALERT_AT && (before.ahead === null || before.ahead > ALERT_AT))
      playAlert(false);
  }, [on, ahead, called]);

  const closed = view.session.status === "ENDED" || view.session.status === "CANCELLED";
  if (closed || view.you.status === "DONE" || view.you.status === "CANCELLED") return null;

  if (!on) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 text-center">
        <button
          type="button"
          onClick={async () => {
            await unlockAudio();
            navigator.vibrate?.(50);
            prev.current = { ahead, called };
            setOn(true);
          }}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-lg font-semibold text-white hover:bg-primary-hover"
        >
          <BellIcon /> {p.alertOn}
        </button>
        <p className="mt-2 text-sm text-ink-muted">{p.alertHint}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] border border-success/40 bg-success-soft px-4 py-3">
      <p className="inline-flex items-center gap-2 font-semibold text-success" role="status">
        <BellIcon /> {p.alertActive}
      </p>
      <button
        type="button"
        onClick={() => setOn(false)}
        className="min-h-12 rounded-lg px-3 font-medium text-ink-muted underline hover:bg-surface"
      >
        {p.alertOff}
      </button>
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function SessionBanner({ view }: { view: PatientView }) {
  const s = view.session;
  const scheduled = new Date(s.scheduledStartAt);
  const timedBreak = useBreak(s.breakEndsAt, view.serverTime);
  if (s.status === "CANCELLED") return <Banner tone="danger">{p.sessionCancelled}</Banner>;
  if (s.status === "ENDED") return <Banner tone="neutral">{p.ended}</Banner>;
  if (s.status === "ON_BREAK") {
    if (!timedBreak || !s.breakKind) return <Banner tone="warning">{p.onBreak}</Banner>;
    const where = p.breakWhere[s.breakKind];
    return (
      <Banner tone="warning" big>
        <span className="block text-xl font-bold">
          {timedBreak.overdue ? p.breakOverdue(where) : p.breakTimed(where, timedBreak.time, timedBreak.left)}
        </span>
      </Banner>
    );
  }
  if (s.status === "NOT_STARTED" && !s.doctorArrivedAt) {
    return (
      <Banner tone="warning" big>
        <span className="block text-2xl font-bold">{p.doctorNotArrived}</span>
        <span className="mt-1 block text-base font-medium">{p.scheduledAt(formatTime(scheduled))}</span>
        {s.announcedDelayMinutes ? (
          <span className="mt-1 block text-base font-medium">{p.delayAnnounced(bn(s.announcedDelayMinutes))}</span>
        ) : null}
      </Banner>
    );
  }
  return <Banner tone="success">{s.status === "DOCTOR_ARRIVED" ? p.doctorArrived : p.running}</Banner>;
}

function YourStatus({ view }: { view: PatientView }) {
  const you = view.you;
  const numbers = (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-[var(--radius-card)] border-2 border-primary bg-primary-soft p-3 text-center">
        <p className="text-sm font-semibold text-ink-muted">{p.nowServing}</p>
        <p className="tabular text-7xl font-bold leading-tight text-primary">
          {view.nowServing !== null ? bn(view.nowServing) : p.nobodyYet}
        </p>
      </div>
      <div className="rounded-[var(--radius-card)] border-2 border-line bg-surface p-3 text-center">
        <p className="text-sm font-semibold text-ink-muted">{p.yourSerial}</p>
        <p className="tabular text-7xl font-bold leading-tight text-ink">{bn(you.serial)}</p>
      </div>
    </div>
  );

  switch (you.status) {
    case "CALLED":
    case "IN_CONSULT":
      return (
        <>
          <Banner tone="primary" big>
            <span className="block text-3xl font-bold">{p.yourTurn}</span>
            <span className="mt-1 block text-lg">{p.yourTurnBody}</span>
          </Banner>
          {numbers}
        </>
      );
    case "DONE":
      return (
        <>
          <Banner tone="success">{p.done}</Banner>
          {numbers}
        </>
      );
    case "SKIPPED":
    case "NO_SHOW":
      return (
        <>
          <Banner tone="warning">{you.status === "SKIPPED" ? p.skipped : p.noShow}</Banner>
          {numbers}
        </>
      );
    case "CANCELLED":
      return you.notComing ? <Banner tone="neutral">{p.notComingDone}</Banner> : <Banner tone="danger">{p.cancelled}</Banner>;
    default:
      return (
        <>
          {view.features.PATIENT_PROGRESS && zoneOf(view) !== "far" ? (
            <Banner tone={zoneOf(view) === "next" ? "success" : "warning"} big>
              <span className="block text-3xl font-bold">{p.getReady}</span>
              <span className="mt-1 block text-base">{p.getReadyBody}</span>
            </Banner>
          ) : (
            you.leaveNow && (
              <Banner tone="success" big>
                <span className="block text-3xl font-bold">{p.leaveNow}</span>
                <span className="mt-1 block text-base">{p.leaveNowBody}</span>
              </Banner>
            )
          )}
          {numbers}
          {view.features.PATIENT_PROGRESS && you.peopleAhead !== null && <Progress view={view} />}
          {you.peopleAhead !== null && (
            <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 text-center text-2xl font-semibold">
              {you.peopleAhead === 0 ? p.aheadZero : you.peopleAhead === 1 ? p.aheadOne : p.ahead(bn(you.peopleAhead))}
            </p>
          )}
          {you.eta && (
            <section
              aria-label={p.etaTitle}
              className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 text-center"
            >
              <h2 className="text-sm font-semibold text-ink-muted">{p.etaTitle}</h2>
              <p className="tabular mt-1 text-3xl font-bold text-ink">
                {you.eta.high === 0 ? p.etaAnyMoment : p.etaRange(bn(you.eta.low), bn(you.eta.high))}
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {p.etaNote} {!you.eta.doctorArrived && p.etaNotArrivedNote} {you.eta.includesBreak && p.etaIncludesBreak}
              </p>
            </section>
          )}
        </>
      );
  }
}

function Banner({
  tone,
  big,
  children,
}: {
  tone: "primary" | "success" | "warning" | "danger" | "neutral";
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-[var(--radius-card)] border-2 px-4 text-center font-semibold",
        big ? "py-5" : "py-3 text-lg",
        tone === "primary" && "border-primary bg-primary text-white",
        tone === "success" && "border-success/40 bg-success-soft text-success",
        tone === "warning" && "border-warning/40 bg-warning-soft text-warning-ink",
        tone === "danger" && "border-danger/40 bg-danger-soft text-danger",
        tone === "neutral" && "border-line bg-canvas text-ink",
      )}
    >
      {children}
    </div>
  );
}

/**
 * "আমি আসছি না": asks once, then tells the chamber. Retries with the same request
 * id on a network error, so a double tap or a flaky connection cancels only once.
 */
function NotComing({ code, view, onView }: { code: string; view: PatientView; onView: (v: PatientView | null) => void }) {
  const [step, setStep] = useState<"idle" | "ask" | "sending" | "failed">("idle");
  const rid = useRef<string | null>(null);
  const closed = view.session.status === "ENDED" || view.session.status === "CANCELLED";
  if (closed || (view.you.status !== "WAITING" && view.you.status !== "SKIPPED")) return null;

  const send = async () => {
    rid.current ??= newRequestId();
    setStep("sending");
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/live/t/${code}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "NOT_COMING", clientRequestId: rid.current }),
        });
        if (res.status >= 500) throw new Error(String(res.status));
        const json = (await res.json().catch(() => null)) as { ok?: boolean; view?: PatientView | null } | null;
        onView(json?.view ?? null);
        if (json?.ok) return;
        break; // refused (e.g. already called): the fresh view explains it
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    setStep("failed");
  };

  if (step === "idle") {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={() => setStep("ask")}
          className="min-h-12 rounded-lg px-4 font-medium text-danger underline underline-offset-2 hover:bg-danger-soft"
        >
          {p.notComing}
        </button>
      </div>
    );
  }
  return (
    <div role="alertdialog" aria-labelledby="nc-ask" className="rounded-[var(--radius-card)] border-2 border-danger/40 bg-danger-soft p-4">
      <p id="nc-ask" className="font-semibold text-danger">
        {step === "failed" ? p.notComingFailed : p.notComingAsk}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setStep("idle")}
          disabled={step === "sending"}
          className="min-h-12 rounded-lg border-2 border-line-strong bg-surface px-3 font-semibold text-ink disabled:opacity-50"
        >
          {p.notComingNo}
        </button>
        <button
          type="button"
          onClick={send}
          disabled={step === "sending"}
          className="min-h-12 rounded-lg bg-danger px-3 font-semibold text-white disabled:opacity-50"
        >
          {step === "sending" ? p.notComingSending : p.notComingYes}
        </button>
      </div>
    </div>
  );
}
