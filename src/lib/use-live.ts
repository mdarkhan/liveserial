"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type LiveMode = "connecting" | "live" | "polling";

const POLL_MS = 15_000; // brief: fall back to polling every 15 s
const STALE_MS = 45_000; // no message or ping for this long → treat the stream as dead
const SSE_RETRY_MS = 120_000; // while polling, try the stream again every 2 min

/**
 * Live data from an SSE endpoint, with a polling fallback.
 * - `url` streams `data:` messages and `ping` events; `url + ?once=1` returns `{ view }` JSON.
 * - Messages older than what we have (by version) are ignored.
 * - `apply` lets callers feed in data from elsewhere (e.g. an action's response).
 * - `updatedAt` moves on every message and ping: "we know this is current as of then".
 */
export function useLive<T>(url: string, initial: T, versionOf: (t: T) => number, initialUpdatedAt: number) {
  const [data, setData] = useState(initial);
  const [mode, setMode] = useState<LiveMode>("connecting");
  // Starts from the server's timestamp so server and client render the same text.
  const [updatedAt, setUpdatedAt] = useState<number>(initialUpdatedAt);
  const versionRef = useRef(versionOf(initial));
  const versionOfRef = useRef(versionOf);

  const apply = useCallback((next: T | null | undefined) => {
    if (!next) return;
    const v = versionOfRef.current(next);
    if (v < versionRef.current) return;
    versionRef.current = v;
    setData(next);
    setUpdatedAt(Date.now());
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSeen = Date.now();
    let stopped = false;
    const onceUrl = url + (url.includes("?") ? "&" : "?") + "once=1";

    const pollOnce = async () => {
      try {
        const res = await fetch(onceUrl, { cache: "no-store" });
        if (res.ok) apply((await res.json()).view as T);
      } catch {
        /* offline: next tick */
      }
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (retryTimer) clearTimeout(retryTimer);
      pollTimer = retryTimer = null;
    };
    const closeStream = () => {
      es?.close();
      es = null;
    };
    const startPolling = () => {
      closeStream();
      if (stopped || pollTimer) return;
      setMode("polling");
      void pollOnce();
      pollTimer = setInterval(pollOnce, POLL_MS);
      retryTimer = setTimeout(() => {
        stopPolling();
        openStream();
      }, SSE_RETRY_MS);
    };
    const openStream = () => {
      if (stopped) return;
      if (typeof EventSource === "undefined") return startPolling();
      lastSeen = Date.now();
      setMode("connecting");
      es = new EventSource(url);
      es.onopen = () => {
        lastSeen = Date.now();
        setMode("live");
        stopPolling();
      };
      es.onmessage = (e) => {
        lastSeen = Date.now();
        setMode("live");
        try {
          apply(JSON.parse(e.data) as T);
        } catch {
          /* ignore */
        }
      };
      es.addEventListener("ping", () => {
        lastSeen = Date.now();
        setUpdatedAt(Date.now());
      });
      es.onerror = () => {
        // CONNECTING: the browser retries by itself; CLOSED: it gave up.
        if (es?.readyState === EventSource.CLOSED) startPolling();
        else setMode("connecting");
      };
    };

    const watchdog = setInterval(() => {
      if (es && Date.now() - lastSeen > STALE_MS) startPolling();
    }, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pollOnce();
    };
    document.addEventListener("visibilitychange", onVisible);

    openStream();
    return () => {
      stopped = true;
      clearInterval(watchdog);
      stopPolling();
      closeStream();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, apply]);

  return { data, apply, mode, updatedAt };
}
