"use client";

import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { bn, formatDate, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import type { PatientView } from "@/lib/snapshot";
import { useLive } from "@/lib/use-live";
import { LiveStatus } from "@/components/live-status";

const p = t.patient;

export function PatientLive({ code, initial }: { code: string; initial: PatientView }) {
  const { data, mode, updatedAt } = useLive<PatientView>(
    `/api/live/t/${code}`,
    initial,
    (v) => v.v,
    Date.parse(initial.serverTime),
  );
  const s = data.session;
  const you = data.you;
  const scheduled = new Date(s.scheduledStartAt);

  return (
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

      <footer className="space-y-1 pt-2 text-center text-sm text-ink-muted">
        <LiveStatus mode={mode} updatedAt={updatedAt} />
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
  );
}

function SessionBanner({ view }: { view: PatientView }) {
  const s = view.session;
  const scheduled = new Date(s.scheduledStartAt);
  if (s.status === "CANCELLED") return <Banner tone="danger">{p.sessionCancelled}</Banner>;
  if (s.status === "ENDED") return <Banner tone="neutral">{p.ended}</Banner>;
  if (s.status === "ON_BREAK") return <Banner tone="warning">{p.onBreak}</Banner>;
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
      return <Banner tone="danger">{p.cancelled}</Banner>;
    default:
      return (
        <>
          {you.leaveNow && (
            <Banner tone="success" big>
              <span className="block text-3xl font-bold">{p.leaveNow}</span>
              <span className="mt-1 block text-base">{p.leaveNowBody}</span>
            </Banner>
          )}
          {numbers}
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
                {p.etaNote} {!you.eta.doctorArrived && p.etaNotArrivedNote}
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
