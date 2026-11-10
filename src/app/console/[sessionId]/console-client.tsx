"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, buttonClass, cx } from "@/components/ui";
import { bn, displayPhone, formatTime, normalizeBdPhone } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import {
  availableDoctorActions,
  jumpedSerials,
  newRequestId,
  OUT_OF_ORDER_REASONS,
  parseBulkList,
  type DoctorStatusAction,
  type OutOfOrderReasonCode,
} from "@/lib/queue";
import { patientLink, renderSms, smsSegments } from "@/lib/sms-text";
import type { ConsoleToken, ConsoleView } from "@/lib/snapshot";
import { sessionTone, tokenTone } from "@/lib/status";
import { useLive, type LiveMode } from "@/lib/use-live";
import { useBreak } from "@/lib/use-break";
import { SmsCost } from "@/components/sms-cost";

const c = t.console;

type BreakKind = "PRAYER" | "BREAK";
const BREAK_MINUTES = [5, 10, 15, 20, 30, 45, 60];

// ───────────── Action outbox ─────────────

type ActionBody =
  | { type: "NEXT"; expectedCurrentTokenId: string | null }
  | {
      type: "CALL";
      tokenId: string;
      expectedCurrentTokenId: string | null;
      reason?: OutOfOrderReasonCode | null;
      note?: string | null;
    }
  | { type: "IN_CONSULT" | "DONE" | "SKIP" | "NO_SHOW" | "CANCEL"; tokenId: string }
  | { type: "REQUEUE"; tokenId: string; mode: "AFTER_CURRENT" | "AT_END" }
  | { type: "DOCTOR"; action: DoctorStatusAction; breakMinutes?: number; breakKind?: BreakKind }
  | { type: "DELAY"; minutes: number }
  | { type: "BROADCAST"; minutes: number }
  | { type: "UNDO"; undoOf: string }
  | {
      type: "ADD";
      patients: Array<{ name: string; phone?: string | null; serial?: number; isEmergency?: boolean }>;
    };

type Pending = {
  rid: string;
  body: ActionBody;
  label: string;
  attempts: number;
  state: "sending" | "retrying" | "failed";
  offline?: boolean;
};

type Notice = { tone: "success" | "danger" | "warning"; text: string } | null;

const MAX_ATTEMPTS = 6;
const backoffMs = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 15_000);
const REQUEST_TIMEOUT_MS = 15_000;
const CALL_TYPES = new Set(["NEXT", "CALL", "IN_CONSULT", "DONE", "NO_SHOW", "UNDO"]);
/** Actions the "undo" toast is offered for (see UNDOABLE_ACTIONS on the server). */
const UNDOABLE_TYPES = new Set(["NEXT", "CALL", "IN_CONSULT", "DONE", "SKIP", "NO_SHOW", "CANCEL"]);
/** How long the "undo" toast stays. */
const UNDO_SHOW_MS = 5_000;

type UndoOffer = { rid: string; label: string; detail: string | null };

async function lookupName(sessionId: string, phone: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/lookup?phone=${encodeURIComponent(phone)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as { name: string | null }).name;
  } catch {
    return null;
  }
}

function errorText(code: string | undefined): string {
  return (c.errors as Record<string, string>)[code ?? ""] ?? c.errors.GENERIC;
}

export function ConsoleClient({
  initial,
  readOnly,
  smsBaseUrl,
}: {
  initial: ConsoleView;
  readOnly: boolean;
  smsBaseUrl: string;
}) {
  const sessionId = initial.session.id;
  // Live view (SSE, falling back to 15 s polling). Action responses feed in through applyView;
  // older versions are ignored, so a slow stream message can't undo a newer action result.
  const {
    data: view,
    apply: applyView,
    mode,
    updatedAt,
  } = useLive<ConsoleView>(
    `/api/live/session/${sessionId}?view=console`,
    initial,
    (v) => v.session.queueVersion,
    Date.parse(initial.serverTime),
  );
  const [pending, setPending] = useState<Pending[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const undoAllowed = view.features.CONSOLE_UNDO && !readOnly;
  const queueRef = useRef<Pending[]>([]);
  const busyRef = useRef(false);

  const flush = () => setPending([...queueRef.current]);

  /** Sends one action. "retry" = network trouble, try again with the SAME request id. */
  const sendOnce = useCallback(
    async (item: Pending): Promise<"done" | "retry"> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientRequestId: item.rid, ...item.body }),
          signal: ctrl.signal,
        });
        if (res.status >= 500 || res.status === 429) return "retry";
        const json = await res.json().catch(() => null);
        if (res.status === 401) {
          setNotice({ tone: "danger", text: c.errors.UNAUTHENTICATED });
          return "done";
        }
        applyView(json?.view);
        if (json?.ok) {
          if (item.body.type === "UNDO") {
            setNotice({ tone: "success", text: c.undoDone(item.label) });
          } else if (undoAllowed && UNDOABLE_TYPES.has(item.body.type)) {
            const r = json.result as { calledSerial?: number | null; serial?: number } | null;
            const serial = r?.calledSerial ?? r?.serial ?? null;
            setUndo({ rid: item.rid, label: item.label, detail: serial ? `${t.token.serial} ${bn(serial)}` : null });
          }
          if (item.body.type === "BROADCAST") {
            setNotice({
              tone: "success",
              text: c.broadcastDone(bn((json.result as { recipients: number }).recipients)),
            });
          }
          if (item.body.type === "ADD") {
            const n = item.body.patients.length;
            const serials = (json.result as Array<{ serial: number }>).map((r) => r.serial);
            setNotice({
              tone: "success",
              text: n === 1 ? t.token.added(bn(serials[0])) : c.addedMany(bn(n)),
            });
          }
        } else {
          setNotice({ tone: json?.code === "CONFLICT" ? "warning" : "danger", text: errorText(json?.code) });
        }
        return "done";
      } catch {
        return "retry"; // offline, timeout, DNS…
      } finally {
        clearTimeout(timer);
      }
    },
    [sessionId, applyView, undoAllowed],
  );

  // The undo offer disappears after a few seconds.
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_SHOW_MS);
    return () => clearTimeout(id);
  }, [undo]);

  const pump = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const item = queueRef.current[0];
        if (item.state === "failed") break; // waits for the user: retry or discard
        const outcome = await sendOnce(item);
        if (outcome === "retry") {
          item.attempts += 1;
          item.offline = typeof navigator !== "undefined" && !navigator.onLine;
          item.state = item.attempts >= MAX_ATTEMPTS ? "failed" : "retrying";
          flush();
          if (item.state === "failed") break;
          await new Promise((r) => setTimeout(r, backoffMs(item.attempts)));
          continue;
        }
        queueRef.current.shift();
        flush();
      }
    } finally {
      busyRef.current = false;
    }
  }, [sendOnce]);

  const act = useCallback(
    (body: ActionBody, label: string) => {
      if (readOnly) return;
      setNotice(null);
      setUndo(null); // anything new makes the previous action final
      queueRef.current.push({ rid: newRequestId(), body, label, attempts: 0, state: "sending" });
      flush();
      void pump();
    },
    [pump, readOnly],
  );

  const retryFailed = () => {
    const head = queueRef.current[0];
    if (!head) return;
    head.state = "sending";
    head.attempts = 0;
    flush();
    void pump();
  };
  const discardFailed = () => {
    queueRef.current.shift();
    flush();
    void pump();
  };

  // Back online: send what's waiting right away instead of waiting out the backoff.
  useEffect(() => {
    const onOnline = () => {
      if (queueRef.current[0]?.state === "retrying") void pump();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [pump]);

  // Don't lose unsent actions by closing the tab.
  useEffect(() => {
    if (pending.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending.length]);

  // ───────── derived ─────────
  const s = view.session;
  const closed = s.status === "ENDED" || s.status === "CANCELLED";
  const canAct = !readOnly && !closed;
  const callBusy = pending.some((p) => CALL_TYPES.has(p.body.type));
  const current = view.current;
  const next = view.waiting[0];

  // ───────── dialogs ─────────
  const [sheetToken, setSheetToken] = useState<ConsoleToken | null>(null);
  const [outOfOrder, setOutOfOrder] = useState<{ token: ConsoleToken; jumped: number[] } | null>(null);
  const [delayOpen, setDelayOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);

  // A patient said "not coming" on their link: tell the assistant right away.
  const notComingIds = view.away.filter((a) => a.notComing).map((a) => a.id);
  const notComingKey = notComingIds.join(",");
  const [seenNotComing, setSeenNotComing] = useState(notComingKey);
  if (notComingKey !== seenNotComing) {
    const seen = new Set(seenNotComing.split(","));
    const fresh = view.away.filter((a) => a.notComing && !seen.has(a.id));
    setSeenNotComing(notComingKey);
    if (fresh.length > 0) {
      setNotice({ tone: "warning", text: c.notComingNotice(fresh.map((a) => bn(a.serial)).join(", ")) });
    }
  }
  const notComingCount = notComingIds.length;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (notComingCount > 0) navigator.vibrate?.([120, 80, 120]);
  }, [notComingCount]);
  const [endOpen, setEndOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const tapNext = () => {
    if (!canAct || callBusy) return;
    navigator.vibrate?.(30);
    act({ type: "NEXT", expectedCurrentTokenId: current?.id ?? null }, c.next);
  };

  const callNow = (token: ConsoleToken) => {
    setSheetToken(null);
    const asQueue = view.waiting.map((w, i) => ({ id: w.id, serial: w.serial, queueOrder: i, status: w.status }));
    const target = asQueue.find((q) => q.id === token.id);
    const jumped = target ? jumpedSerials(target, asQueue) : [];
    if (jumped.length > 0) setOutOfOrder({ token, jumped });
    else act({ type: "CALL", tokenId: token.id, expectedCurrentTokenId: current?.id ?? null }, c.callNow);
  };

  const doctorButtons = canAct ? availableDoctorActions(s.status) : [];
  const lookup = useCallback(
    (phone: string) => (view.features.CONSOLE_LOOKUP ? lookupName(sessionId, phone) : Promise.resolve(null)),
    [view.features.CONSOLE_LOOKUP, sessionId],
  );

  return (
    <div className="mx-auto w-full max-w-xl pb-40">
      {/* ───── header ───── */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link
            href="/console"
            className="-ml-2 inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-2xl text-primary hover:bg-primary-soft"
            aria-label={c.backToList}
          >
            ‹
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold leading-tight">{s.doctorName}</p>
            <p className="truncate text-sm text-ink-muted">
              {s.chamberName} · {formatTime(new Date(s.scheduledStartAt))}
            </p>
          </div>
          <Badge tone={sessionTone(s.status)}>{t.sessionStatus[s.status]}</Badge>
        </div>
        <SyncStatus
          pending={pending}
          mode={mode}
          updatedAt={updatedAt}
          onRetry={retryFailed}
          onDiscard={discardFailed}
        />
      </header>

      <main className="space-y-4 px-4 pt-4">
        {readOnly && <p className="rounded-lg border border-line bg-canvas px-4 py-3 text-ink-muted">{c.readOnly}</p>}

        <div aria-live="polite" aria-atomic="true">
          {notice && (
            <p
              className={cx(
                "rounded-lg border px-4 py-3 font-medium",
                notice.tone === "success" && "border-success/30 bg-success-soft text-success",
                notice.tone === "warning" && "border-warning/30 bg-warning-soft text-warning-ink",
                notice.tone === "danger" && "border-danger/30 bg-danger-soft text-danger",
              )}
            >
              {notice.text}
            </p>
          )}
        </div>

        {/* ───── doctor status ───── */}
        {(doctorButtons.length > 0 || s.announcedDelayMinutes || s.breakEndsAt) && (
          <section aria-label={t.common.status} className="flex flex-wrap gap-2">
            {doctorButtons.includes("ARRIVED") && (
              <button
                className={buttonClass("primary")}
                onClick={() => act({ type: "DOCTOR", action: "ARRIVED" }, c.doctorArrived)}
              >
                {c.doctorArrived}
              </button>
            )}
            {doctorButtons.includes("RESUME") && (
              <button
                className={buttonClass("primary")}
                onClick={() => act({ type: "DOCTOR", action: "RESUME" }, c.doctorResume)}
              >
                {c.doctorResume}
              </button>
            )}
            {doctorButtons.includes("BREAK") && (
              <button
                className={buttonClass("secondary")}
                onClick={() =>
                  view.features.DOCTOR_BREAK_TIMER
                    ? setBreakOpen(true)
                    : act({ type: "DOCTOR", action: "BREAK" }, c.doctorBreak)
                }
              >
                {c.doctorBreak}
              </button>
            )}
            {canAct && s.status === "NOT_STARTED" && (
              <button className={buttonClass("secondary")} onClick={() => setDelayOpen(true)}>
                {c.runningLate}
              </button>
            )}
            {canAct && (
              <button className={buttonClass("secondary")} onClick={() => setBroadcastOpen(true)}>
                {c.broadcast}
              </button>
            )}
            {doctorButtons.includes("END") && (
              <button className={buttonClass("ghost", "md", "ml-auto")} onClick={() => setEndOpen(true)}>
                {c.endSession}
              </button>
            )}
            {s.announcedDelayMinutes ? (
              <p className="w-full font-medium text-warning-ink">{c.delayNow(bn(s.announcedDelayMinutes))}</p>
            ) : null}
            {s.status === "ON_BREAK" && s.breakEndsAt && s.breakKind && (
              <BreakLine kind={s.breakKind} endsAt={s.breakEndsAt} serverTime={view.serverTime} />
            )}
          </section>
        )}

        {/* ───── now serving ───── */}
        <section
          aria-labelledby="now-h"
          className={cx(
            "rounded-[var(--radius-card)] border-2 p-4",
            current ? "border-primary bg-primary-soft" : "border-line bg-surface",
          )}
        >
          <h2 id="now-h" className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {c.nowServing}
          </h2>
          {current ? (
            <>
              <div className="mt-1 flex items-center gap-4">
                <span className="tabular text-7xl font-bold leading-none text-primary">{bn(current.serial)}</span>
                <div className="min-w-0">
                  <p className="text-xl font-semibold">{current.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={tokenTone(current.status)}>{t.tokenStatus[current.status]}</Badge>
                    {current.isEmergency && <Badge tone="danger">{t.token.emergency}</Badge>}
                  </div>
                </div>
              </div>
              {canAct && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {current.status === "CALLED" && (
                    <>
                      <button
                        className={buttonClass("secondary")}
                        disabled={callBusy}
                        onClick={() => act({ type: "IN_CONSULT", tokenId: current.id }, c.entered)}
                      >
                        {c.entered}
                      </button>
                      <button
                        className={buttonClass("danger")}
                        disabled={callBusy}
                        onClick={() => act({ type: "NO_SHOW", tokenId: current.id }, c.notHere)}
                      >
                        {c.notHere}
                      </button>
                    </>
                  )}
                  {current.status === "IN_CONSULT" && (
                    <button
                      className={buttonClass("secondary", "md", "col-span-2")}
                      disabled={callBusy}
                      onClick={() => act({ type: "DONE", tokenId: current.id }, c.done)}
                    >
                      {c.done}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 text-lg text-ink-muted">{c.nobodyInside}</p>
          )}
        </section>

        {/* ───── waiting ───── */}
        <section aria-labelledby="waiting-h">
          <h2 id="waiting-h" className="mb-2 flex items-baseline justify-between text-lg font-semibold">
            <span>
              {c.waiting} (<span className="tabular">{bn(view.waiting.length)}</span>)
            </span>
            <span className="text-sm font-normal text-ink-muted">{c.doneCount(bn(view.doneCount))}</span>
          </h2>
          {view.waiting.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong/50 bg-surface p-4 text-center text-ink-muted">
              {c.emptyWaiting}
            </p>
          ) : (
            <TokenList tokens={view.waiting} onPick={canAct ? setSheetToken : undefined} />
          )}
        </section>

        {view.away.length > 0 && (
          <section aria-labelledby="away-h">
            <h2 id="away-h" className="mb-2 text-lg font-semibold">
              {c.away} (<span className="tabular">{bn(view.away.length)}</span>)
            </h2>
            <TokenList tokens={view.away} onPick={canAct ? setSheetToken : undefined} />
          </section>
        )}

        {canAct && (
          <AddPatients
            onAdd={(patients, label) => act({ type: "ADD", patients }, label)}
            lookup={view.features.CONSOLE_LOOKUP ? lookup : undefined}
            smsPreview={
              view.features.SMS_COST_PREVIEW
                ? () =>
                    // Public codes are always 10 characters, so this matches the real message's length.
                    renderSms("TOKEN_CREATED", {
                      serial: view.total + 1,
                      doctorName: s.doctorName,
                      link: patientLink(smsBaseUrl, "x".repeat(10)),
                    })
                : undefined
            }
          />
        )}
      </main>

      {/* ───── the big button (thumb zone) ───── */}
      {canAct && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto max-w-xl">
            {undo && (
              <div
                key={undo.rid}
                role="status"
                className="relative mb-2 flex items-center gap-3 overflow-hidden rounded-xl bg-ink px-4 py-2 text-white shadow-lg"
              >
                <p className="min-w-0 flex-1 font-medium">
                  {c.undoAfter(undo.label)}
                  {undo.detail && <span className="text-white/80"> · {undo.detail}</span>}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const offer = undo;
                    navigator.vibrate?.(20);
                    act({ type: "UNDO", undoOf: offer.rid }, offer.label);
                  }}
                  className="min-h-12 shrink-0 rounded-lg bg-white px-4 font-bold text-ink hover:bg-white/90"
                >
                  {c.undo}
                </button>
                <span
                  aria-hidden="true"
                  className="undo-timer absolute inset-x-0 bottom-0 h-1 origin-left bg-warning"
                  style={{ animationDuration: `${UNDO_SHOW_MS}ms` }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={tapNext}
              disabled={callBusy || (!next && !current)}
              className="flex min-h-[4.5rem] w-full flex-col items-center justify-center rounded-xl bg-primary px-4 text-white shadow-sm transition-colors hover:bg-primary-hover active:bg-primary-hover disabled:opacity-50"
            >
              <span className="text-2xl font-bold">
                {callBusy ? c.syncing : next ? c.next : current ? c.finishLast : c.nobodyWaiting}
              </span>
              {next && !callBusy && <span className="text-base opacity-90">{c.nextPreview(bn(next.serial))}</span>}
            </button>
          </div>
        </div>
      )}

      {/* ───── dialogs ───── */}
      <Sheet
        open={!!sheetToken}
        onClose={() => setSheetToken(null)}
        title={sheetToken ? `${t.token.serial} ${bn(sheetToken.serial)}` : ""}
      >
        {sheetToken && (
          <div className="space-y-3">
            <p className="text-xl font-semibold">
              {sheetToken.name} {sheetToken.isEmergency && <Badge tone="danger">{t.token.emergency}</Badge>}
            </p>
            {sheetToken.phone && (
              <a
                href={`tel:+${sheetToken.phone}`}
                className="inline-flex min-h-12 items-center font-medium text-primary underline"
              >
                {c.phone}: {bn(displayPhone(sheetToken.phone))}
              </a>
            )}
            {sheetToken.status === "WAITING" ? (
              <div className="grid gap-2">
                <button
                  className={buttonClass("primary", "lg")}
                  disabled={callBusy}
                  onClick={() => callNow(sheetToken)}
                >
                  {c.callNow}
                </button>
                <button
                  className={buttonClass("secondary", "lg")}
                  onClick={() => {
                    act({ type: "SKIP", tokenId: sheetToken.id }, c.skip);
                    setSheetToken(null);
                  }}
                >
                  {c.skip}
                </button>
                <CancelTokenButton
                  onConfirm={() => {
                    act({ type: "CANCEL", tokenId: sheetToken.id }, c.cancelToken);
                    setSheetToken(null);
                  }}
                />
              </div>
            ) : (
              <div className="grid gap-2">
                {sheetToken.notComing && (
                  <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 font-medium text-warning-ink">
                    {c.notComingNotice(bn(sheetToken.serial))}
                  </p>
                )}
                <p className="font-semibold">{c.requeueTitle}</p>
                <button
                  className={buttonClass("primary", "lg")}
                  onClick={() => {
                    act({ type: "REQUEUE", tokenId: sheetToken.id, mode: "AFTER_CURRENT" }, c.requeueAfter);
                    setSheetToken(null);
                  }}
                >
                  {c.requeueAfter}
                </button>
                <button
                  className={buttonClass("secondary", "lg")}
                  onClick={() => {
                    act({ type: "REQUEUE", tokenId: sheetToken.id, mode: "AT_END" }, c.requeueEnd);
                    setSheetToken(null);
                  }}
                >
                  {c.requeueEnd}
                </button>
                {!sheetToken.notComing && (
                  <CancelTokenButton
                    onConfirm={() => {
                      act({ type: "CANCEL", tokenId: sheetToken.id }, c.cancelToken);
                      setSheetToken(null);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>

      <OutOfOrderDialog
        state={outOfOrder}
        onClose={() => setOutOfOrder(null)}
        onConfirm={(reason, note) => {
          if (!outOfOrder) return;
          act(
            {
              type: "CALL",
              tokenId: outOfOrder.token.id,
              expectedCurrentTokenId: current?.id ?? null,
              reason,
              note,
            },
            c.callNow,
          );
          setOutOfOrder(null);
        }}
      />

      <Sheet open={breakOpen} onClose={() => setBreakOpen(false)} title={c.breakTitle}>
        {breakOpen && (
          <BreakForm
            onPick={(minutes, kind) => {
              setBreakOpen(false);
              if (minutes === null) act({ type: "DOCTOR", action: "BREAK" }, c.doctorBreak);
              else
                act(
                  { type: "DOCTOR", action: "BREAK", breakMinutes: minutes, breakKind: kind },
                  c.breakStart(c.breakKinds[kind], bn(minutes)),
                );
            }}
          />
        )}
      </Sheet>

      <Sheet open={delayOpen} onClose={() => setDelayOpen(false)} title={c.delayTitle}>
        <div className="grid grid-cols-3 gap-2">
          {[10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
            <button
              key={m}
              className={buttonClass(s.announcedDelayMinutes === m ? "primary" : "secondary")}
              onClick={() => {
                act({ type: "DELAY", minutes: m }, c.runningLate);
                setDelayOpen(false);
              }}
            >
              {c.delayMinutes(bn(m))}
            </button>
          ))}
          <button
            className={buttonClass("ghost", "md", "col-span-3")}
            onClick={() => {
              act({ type: "DELAY", minutes: 0 }, c.delayNone);
              setDelayOpen(false);
            }}
          >
            {c.delayNone}
          </button>
        </div>
      </Sheet>

      <Sheet open={broadcastOpen} onClose={() => setBroadcastOpen(false)} title={c.broadcastTitle}>
        {broadcastOpen && (
          <BroadcastForm
            view={view}
            baseUrl={smsBaseUrl}
            initialMinutes={s.announcedDelayMinutes ?? 30}
            showCost={view.features.SMS_COST_PREVIEW}
            onCancel={() => setBroadcastOpen(false)}
            onSend={(minutes) => {
              act({ type: "BROADCAST", minutes }, c.broadcast);
              setBroadcastOpen(false);
            }}
          />
        )}
      </Sheet>

      <Sheet open={endOpen} onClose={() => setEndOpen(false)} title={c.endSession}>
        <p className="mb-4">{c.endConfirm}</p>
        <div className="grid grid-cols-2 gap-2">
          <button className={buttonClass("secondary")} onClick={() => setEndOpen(false)}>
            {t.common.cancel}
          </button>
          <button
            className={buttonClass("danger")}
            onClick={() => {
              act({ type: "DOCTOR", action: "END" }, c.endSession);
              setEndOpen(false);
            }}
          >
            {c.endSession}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

// ───────────── pieces ─────────────

function SyncStatus({
  pending,
  mode,
  updatedAt,
  onRetry,
  onDiscard,
}: {
  pending: Pending[];
  mode: LiveMode;
  updatedAt: number;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const head = pending[0];
  if (head?.state === "failed") {
    return (
      <div role="alert" className="mt-2 rounded-lg border border-danger/40 bg-danger-soft p-2">
        <p className="font-semibold text-danger">
          {c.failed}: {head.label}
        </p>
        <div className="mt-1 flex gap-2">
          <button className={buttonClass("primary")} onClick={onRetry}>
            {c.retry}
          </button>
          <button className={buttonClass("ghost")} onClick={onDiscard}>
            {c.discard}
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-2 text-sm" role="status">
      {head ? (
        <>
          <span aria-hidden="true" className="inline-block size-2.5 animate-pulse rounded-full bg-warning" />
          <span className="font-medium text-warning-ink">
            {head.state === "retrying" && head.offline ? c.offline : c.syncing}
          </span>
        </>
      ) : (
        <>
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-success" />
          <span className="font-medium text-success">{c.synced}</span>
          <span className="text-ink-muted">
            · {mode === "live" ? t.live.live : mode === "polling" ? t.live.polling : t.live.connecting} ·{" "}
            {c.updatedAt(formatTime(new Date(updatedAt)))}
          </span>
        </>
      )}
    </p>
  );
}

function TokenList({ tokens, onPick }: { tokens: ConsoleToken[]; onPick?: (t: ConsoleToken) => void }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {tokens.map((tk) => {
        const content = (
          <>
            <span className="tabular w-14 shrink-0 text-3xl font-bold text-ink">{bn(tk.serial)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-lg">{tk.name}</span>
              {(tk.isEmergency || tk.status !== "WAITING") && (
                <span className="mt-0.5 flex flex-wrap gap-1">
                  {tk.notComing ? (
                    <Badge tone="warning">{c.notComing}</Badge>
                  ) : (
                    tk.status !== "WAITING" && <Badge tone={tokenTone(tk.status)}>{t.tokenStatus[tk.status]}</Badge>
                  )}
                  {tk.isEmergency && <Badge tone="danger">{t.token.emergency}</Badge>}
                </span>
              )}
            </span>
            {onPick && (
              <span aria-hidden="true" className="text-2xl text-ink-muted">
                ⋯
              </span>
            )}
          </>
        );
        return (
          <li key={tk.id}>
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(tk)}
                className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left hover:bg-canvas"
              >
                {content}
              </button>
            ) : (
              <div className="flex min-h-16 items-center gap-3 px-4 py-2">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Native <dialog>: focus trap, Esc to close, backdrop. A bottom sheet on phones. */
function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="sheet-title"
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none rounded-t-2xl bg-surface p-0 text-ink backdrop:bg-black/50 sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      {open && (
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="sheet-title" className="text-xl font-bold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={c.close}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-2xl text-ink-muted hover:bg-canvas"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

function CancelTokenButton({ onConfirm }: { onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button className={buttonClass("ghost", "md", "text-danger")} onClick={() => setAsking(true)}>
        {c.cancelToken}
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-danger/40 bg-danger-soft p-3">
      <p className="mb-2 font-medium text-danger">{c.cancelConfirm}</p>
      <div className="grid grid-cols-2 gap-2">
        <button className={buttonClass("secondary")} onClick={() => setAsking(false)}>
          {t.common.no}
        </button>
        <button className={buttonClass("danger")} onClick={onConfirm}>
          {t.common.yes}
        </button>
      </div>
    </div>
  );
}

function OutOfOrderDialog({
  state,
  onClose,
  onConfirm,
}: {
  state: { token: ConsoleToken; jumped: number[] } | null;
  onClose: () => void;
  onConfirm: (reason: OutOfOrderReasonCode, note: string | null) => void;
}) {
  return (
    <Sheet open={!!state} onClose={onClose} title={c.outOfOrderTitle}>
      {/* Keyed so each patient gets a fresh form. */}
      {state && <OutOfOrderForm key={state.token.id} state={state} onClose={onClose} onConfirm={onConfirm} />}
    </Sheet>
  );
}

function OutOfOrderForm({
  state,
  onClose,
  onConfirm,
}: {
  state: { token: ConsoleToken; jumped: number[] };
  onClose: () => void;
  onConfirm: (reason: OutOfOrderReasonCode, note: string | null) => void;
}) {
  // An emergency-flagged patient pre-selects "জরুরি".
  const [reason, setReason] = useState<OutOfOrderReasonCode | null>(state.token.isEmergency ? "EMERGENCY" : null);
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const shown = state.jumped
    .slice(0, 8)
    .map((n) => bn(n))
    .join(", ");
  const more = state.jumped.length > 8 ? " …" : "";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason || (reason === "OTHER" && !note.trim())) return setError(true);
        onConfirm(reason, note.trim() || null);
      }}
      className="space-y-3"
    >
      <p className="text-lg">
        <span className="font-bold">
          {t.token.serial} {bn(state.token.serial)}
        </span>{" "}
        — {state.token.name}
      </p>
      <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-warning-ink">
        {c.outOfOrderBody(shown + more)}
      </p>
      <fieldset className="space-y-1">
        <legend className="sr-only">{c.outOfOrderTitle}</legend>
        {OUT_OF_ORDER_REASONS.map((r) => (
          <label
            key={r}
            className={cx(
              "flex min-h-12 items-center gap-3 rounded-lg border-2 px-3",
              reason === r ? "border-primary bg-primary-soft" : "border-line",
            )}
          >
            <input
              type="radio"
              name="reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              className="size-5 accent-primary"
            />
            <span className="font-medium">{c.reasons[r]}</span>
          </label>
        ))}
      </fieldset>
      {reason === "OTHER" && (
        <label className="block">
          <span className="mb-1 block font-medium">{c.reasonNote}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            className="block w-full rounded-lg border-2 border-line-strong px-3 py-2"
          />
        </label>
      )}
      {error && (
        <p role="alert" className="font-medium text-danger">
          {reason === "OTHER" ? c.reasonNoteRequired : c.errors.REASON_REQUIRED}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={buttonClass("secondary", "lg")} onClick={onClose}>
          {t.common.cancel}
        </button>
        <button type="submit" className={buttonClass("primary", "lg")}>
          {c.confirmCall}
        </button>
      </div>
    </form>
  );
}

function AddPatients({
  onAdd,
  lookup,
  smsPreview,
}: {
  onAdd: (
    patients: Array<{ name: string; phone?: string | null; serial?: number; isEmergency?: boolean }>,
    label: string,
  ) => void;
  /** Returning patient: name on the latest serial with this phone (only when switched on). */
  lookup?: (phone: string) => Promise<string | null>;
  /** SMS cost preview: the creation SMS this patient would get (only when switched on). */
  smsPreview?: (phone: string) => string;
}) {
  const [mode, setMode] = useState<"quick" | "bulk">("quick");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [emergency, setEmergency] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const [bulk, setBulk] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const parsed = bulk.trim() ? parseBulkList(bulk) : null;

  // Returning patient: once the phone number is complete, look up the last name used with it.
  const [found, setFound] = useState<{ phone: string; name: string; filled: boolean } | null>(null);
  const phoneNorm = normalizeBdPhone(phone);
  useEffect(() => {
    if (!lookup || !phoneNorm) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      const n = await lookup(phoneNorm);
      if (cancelled || !n) return;
      const empty = !nameRef.current?.value.trim();
      if (empty) setName(n);
      setFound({ phone: phoneNorm, name: n, filled: empty });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [lookup, phoneNorm]);
  const match = found && found.phone === phoneNorm ? found : null;

  return (
    <section aria-labelledby="add-h" className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 id="add-h" className="sr-only">
        {c.quickAdd}
      </h2>
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-canvas p-1">
        {(["quick", "bulk"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cx(
              "min-h-12 rounded-md font-semibold",
              mode === m ? "bg-surface text-primary shadow-sm" : "text-ink-muted",
            )}
          >
            {m === "quick" ? c.quickAdd : c.bulkAdd}
          </button>
        ))}
      </div>

      {mode === "quick" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return nameRef.current?.focus();
            if (phone.trim() && !normalizeBdPhone(phone)) return setPhoneError(true);
            onAdd([{ name: name.trim(), phone: phone.trim() || null, isEmergency: emergency }], c.quickAdd);
            setName("");
            setPhone("");
            setEmergency(false);
            setPhoneError(false);
            setFound(null);
            nameRef.current?.focus();
          }}
        >
          {lookup ? (
            <>
              <label className="block">
                <span className="mb-1 block font-medium">{t.token.patientPhone}</span>
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneError(false);
                  }}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  aria-invalid={phoneError || undefined}
                  aria-describedby="qa-phone-hint"
                  className="block min-h-12 w-full rounded-lg border-2 border-line-strong px-3 aria-[invalid=true]:border-danger"
                />
                <span
                  id="qa-phone-hint"
                  className={cx("mt-1 block text-sm", phoneError ? "font-medium text-danger" : "text-ink-muted")}
                >
                  {phoneError ? t.validation.phone : t.token.phoneOptional}
                </span>
                {smsPreview && phoneNorm && (
              <SmsCost text={smsPreview(phoneNorm)} label={t.smsCost.addLabel} className="mt-2" />
            )}
                {match && (
                  <span
                    role="status"
                    className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-success"
                  >
                    {match.filled && match.name === name ? (
                      c.lookupFilled
                    ) : (
                      <>
                        {c.lookupSuggest(match.name)}
                        {match.name !== name && (
                          <button
                            type="button"
                            onClick={() => setName(match.name)}
                            className="min-h-12 rounded-lg px-2 text-primary underline"
                          >
                            {c.lookupUse}
                          </button>
                        )}
                      </>
                    )}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">
                  {t.token.patientName}{" "}
                  <span className="text-danger" aria-hidden="true">
                    *
                  </span>
                </span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="off"
                  className="block min-h-12 w-full rounded-lg border-2 border-line-strong px-3"
                />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block font-medium">
                  {t.token.patientName}{" "}
                  <span className="text-danger" aria-hidden="true">
                    *
                  </span>
                </span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="off"
                  className="block min-h-12 w-full rounded-lg border-2 border-line-strong px-3"
                />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium">{t.token.patientPhone}</span>
                <input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setPhoneError(false);
                  }}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  aria-invalid={phoneError || undefined}
                  aria-describedby="qa-phone-hint"
                  className="block min-h-12 w-full rounded-lg border-2 border-line-strong px-3 aria-[invalid=true]:border-danger"
                />
                <span
                  id="qa-phone-hint"
                  className={cx("mt-1 block text-sm", phoneError ? "font-medium text-danger" : "text-ink-muted")}
                >
                  {phoneError ? t.validation.phone : t.token.phoneOptional}
                </span>
                {smsPreview && phoneNorm && (
              <SmsCost text={smsPreview(phoneNorm)} label={t.smsCost.addLabel} className="mt-2" />
            )}
                {match && (
                  <span
                    role="status"
                    className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-success"
                  >
                    {match.filled && match.name === name ? (
                      c.lookupFilled
                    ) : (
                      <>
                        {c.lookupSuggest(match.name)}
                        {match.name !== name && (
                          <button
                            type="button"
                            onClick={() => setName(match.name)}
                            className="min-h-12 rounded-lg px-2 text-primary underline"
                          >
                            {c.lookupUse}
                          </button>
                        )}
                      </>
                    )}
                  </span>
                )}
              </label>
            </>
          )}
          <label className="flex min-h-12 items-center gap-3 font-medium">
            <input
              type="checkbox"
              checked={emergency}
              onChange={(e) => setEmergency(e.target.checked)}
              className="size-6 accent-primary"
            />
            {t.token.emergency}
          </label>
          <button type="submit" className={buttonClass("secondary", "lg", "w-full")}>
            {c.quickAdd}
          </button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!parsed || parsed.errors.length > 0 || parsed.patients.length === 0) return;
            onAdd(
              parsed.patients.map((p) => ({ name: p.name, phone: p.phone, serial: p.serial })),
              c.bulkAdd,
            );
            setBulk("");
          }}
        >
          <label className="block">
            <span className="mb-1 block font-medium">{c.bulkAdd}</span>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={6}
              aria-describedby="bulk-hint"
              className="block w-full rounded-lg border-2 border-line-strong px-3 py-2"
            />
            <span id="bulk-hint" className="mt-1 block text-sm text-ink-muted">
              {c.bulkHint}
            </span>
          </label>
          {parsed && parsed.errors.length > 0 && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-danger">
              <p className="font-semibold">{c.bulkErrors(bn(parsed.errors.length))}</p>
              <ul className="mt-1 list-disc pl-5">
                {parsed.errors.slice(0, 10).map((er) => (
                  <li key={er.line}>
                    {c.line(bn(er.line))}: {c.bulkReasons[er.reason]} — “{er.text}”
                  </li>
                ))}
              </ul>
            </div>
          )}
          {parsed && parsed.patients.length > 0 && (
            <div className="rounded-lg border border-line bg-canvas p-3">
              <p className="font-semibold">{c.bulkPreview(bn(parsed.patients.length))}</p>
              <ul className="mt-1 max-h-48 overflow-y-auto text-sm">
                {parsed.patients.map((p) => (
                  <li key={p.line} className="py-0.5">
                    {p.serial ? `${bn(p.serial)}. ` : "• "}
                    {p.name}
                    {p.phone ? ` · ${bn(displayPhone(p.phone))}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="submit"
            disabled={!parsed || parsed.errors.length > 0 || parsed.patients.length === 0}
            className={buttonClass("secondary", "lg", "w-full")}
          >
            {c.bulkSubmit(bn(parsed?.patients.length ?? 0))}
          </button>
        </form>
      )}
    </section>
  );
}

/** Pick the delay, see one real message and the exact counts, then confirm. */
function BroadcastForm({
  view,
  baseUrl,
  initialMinutes,
  showCost,
  onCancel,
  onSend,
}: {
  view: ConsoleView;
  baseUrl: string;
  initialMinutes: number;
  showCost?: boolean;
  onCancel: () => void;
  onSend: (minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(Math.max(10, initialMinutes));
  const recipients = view.waiting.filter((w) => w.phone);
  // Public codes are always 10 characters, so these match the real messages' length.
  const bodies = recipients.map((r) =>
    renderSms("DELAY_BROADCAST", {
      serial: r.serial,
      doctorName: view.session.doctorName,
      minutes,
      link: patientLink(baseUrl, "x".repeat(10)),
    }),
  );
  const perSms = bodies.length ? Math.max(...bodies.map((b) => smsSegments(b).segments)) : 0;
  const total = bodies.reduce((sum, b) => sum + smsSegments(b).segments, 0);

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 font-semibold">{c.broadcastPick}</legend>
        <div className="grid grid-cols-4 gap-2">
          {[10, 15, 20, 30, 45, 60, 90, 120].map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={minutes === m}
              onClick={() => setMinutes(m)}
              className={buttonClass(minutes === m ? "primary" : "secondary", "md", "px-1")}
            >
              {bn(m)}
            </button>
          ))}
        </div>
      </fieldset>
      {recipients.length === 0 ? (
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-warning-ink">
          {c.broadcastNone}
        </p>
      ) : (
        <>
          <div>
            <p className="mb-1 text-sm font-semibold text-ink-muted">{c.broadcastPreview}</p>
            <p className="rounded-lg border border-line bg-canvas px-3 py-2 break-words">{bodies[0]}</p>
            {showCost && <SmsCost text={bodies.reduce((a, b) => (b.length > a.length ? b : a), bodies[0])} className="mt-2" />}
          </div>
          <p className="rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 font-semibold text-primary">
            {c.broadcastCounts(bn(recipients.length), bn(perSms), bn(total))}
          </p>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={buttonClass("secondary", "lg")} onClick={onCancel}>
          {t.common.cancel}
        </button>
        <button
          type="button"
          disabled={recipients.length === 0}
          className={buttonClass("primary", "lg")}
          onClick={() => onSend(minutes)}
        >
          {c.broadcastSend(bn(recipients.length))}
        </button>
      </div>
    </div>
  );
}

/** "নামাজ: ফিরবেন ~৮:১৫ (আর ১২ মিনিট)" while a timed break runs. */
function BreakLine({ kind, endsAt, serverTime }: { kind: BreakKind; endsAt: string; serverTime: string }) {
  const b = useBreak(endsAt, serverTime);
  if (!b) return null;
  return (
    <p className={cx("w-full font-semibold", b.overdue ? "text-danger" : "text-warning-ink")} role="status">
      {b.overdue ? c.breakOverdue(c.breakKinds[kind], b.time) : c.breakUntil(c.breakKinds[kind], b.time, b.left)}
    </p>
  );
}

/** Pick the kind (prayer / break) and length; or a break without a timer. */
function BreakForm({ onPick }: { onPick: (minutes: number | null, kind: BreakKind) => void }) {
  const [kind, setKind] = useState<BreakKind>("PRAYER");
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 font-semibold">{c.breakKind}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["PRAYER", "BREAK"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={buttonClass(kind === k ? "primary" : "secondary", "lg")}
            >
              {c.breakKinds[k]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold">{c.breakMinutes}</legend>
        <div className="grid grid-cols-4 gap-2">
          {BREAK_MINUTES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onPick(m, kind)}
              className={buttonClass("secondary", "md", "px-1")}
              aria-label={c.breakStart(c.breakKinds[kind], bn(m))}
            >
              {bn(m)}
            </button>
          ))}
        </div>
      </fieldset>
      <button type="button" className={buttonClass("ghost", "md", "w-full")} onClick={() => onPick(null, kind)}>
        {c.breakNoTimer}
      </button>
    </div>
  );
}
