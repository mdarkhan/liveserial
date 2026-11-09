import { Client } from "pg";
import { NOTIFY_CHANNEL } from "@/lib/queue-service";
import { loadSessionData, type SessionData } from "@/lib/snapshot";

/**
 * Live-update hub (one per app instance).
 *
 *   queue change ─ pg_notify('liveserial', {s, v}) inside the transaction
 *        │  (Postgres delivers it only on COMMIT, to every listening instance)
 *        ▼
 *   one dedicated pg connection: LISTEN liveserial
 *        │
 *        ▼
 *   load the session ONCE (coalesced if more changes arrive mid-load)
 *        │
 *        ▼
 *   every subscriber of that session projects what it may see and sends it (SSE)
 *
 * The notification only says "session X changed"; data always comes from the DB.
 * Uses DIRECT_DATABASE_URL when set (LISTEN can't go through a transaction-mode pooler).
 */

type Listener = (data: SessionData) => void;

const REFRESH_EVERY_MS = 60_000; // also catches any missed notification, and keeps time-based info fresh

class RealtimeHub {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectDelay = 1000;
  private listeners = new Map<string, Set<Listener>>();
  private loading = new Map<string, Promise<void>>();
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Subscribe to a session's changes. Returns an unsubscribe function. */
  subscribe(sessionId: string, listener: Listener): () => void {
    void this.ensureConnected();
    this.ensureTimer();
    let set = this.listeners.get(sessionId);
    if (!set) this.listeners.set(sessionId, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(sessionId);
    };
  }

  /** Number of open subscriptions (for logs/tests). */
  get subscriberCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  /** Reload a session and push it to its subscribers. Coalesces bursts. */
  refresh(sessionId: string): void {
    if (!this.listeners.has(sessionId)) return;
    if (this.loading.has(sessionId)) {
      this.dirty.add(sessionId);
      return;
    }
    const run = (async () => {
      try {
        const data = await loadSessionData(sessionId);
        if (!data) return;
        for (const listener of this.listeners.get(sessionId) ?? []) {
          try {
            listener(data);
          } catch (e) {
            console.error("[realtime] listener failed", e);
          }
        }
      } catch (e) {
        console.error("[realtime] load failed", sessionId, e);
      } finally {
        this.loading.delete(sessionId);
        if (this.dirty.delete(sessionId)) this.refresh(sessionId);
      }
    })();
    this.loading.set(sessionId, run);
  }

  private refreshAll() {
    for (const id of this.listeners.keys()) this.refresh(id);
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.refreshAll(), REFRESH_EVERY_MS);
    this.timer.unref?.();
  }

  private ensureConnected(): Promise<void> {
    if (this.client) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = new Client({
        connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
      });
      client.on("notification", (msg) => {
        if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
        try {
          const { s } = JSON.parse(msg.payload) as { s: string; v: number };
          this.refresh(s);
        } catch {
          /* ignore malformed payloads */
        }
      });
      const lost = (why: unknown) => {
        if (this.client !== client) return;
        console.warn("[realtime] LISTEN connection lost, reconnecting", why instanceof Error ? why.message : why);
        this.client = null;
        client.removeAllListeners();
        client.end().catch(() => {});
        setTimeout(() => void this.ensureConnected(), this.reconnectDelay).unref?.();
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      };
      client.on("error", lost);
      client.on("end", () => lost("ended"));
      try {
        await client.connect();
        await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
        this.client = client;
        this.reconnectDelay = 1000;
        // We may have missed changes while disconnected: push fresh data to everyone.
        this.refreshAll();
      } catch (e) {
        console.warn("[realtime] LISTEN connect failed, retrying", e instanceof Error ? e.message : e);
        client.end().catch(() => {});
        setTimeout(() => void this.ensureConnected(), this.reconnectDelay).unref?.();
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }
}

const g = globalThis as unknown as { liveserialHub?: RealtimeHub };
/** Shared across route modules and dev hot reloads. */
export const hub = g.liveserialHub ?? (g.liveserialHub = new RealtimeHub());

// ───────────── SSE helper ─────────────

const encoder = new TextEncoder();
const PING_EVERY_MS = 20_000;

/**
 * An SSE response for one viewer of a session. `project` turns the session
 * data into what this viewer may see (or null to send nothing). Sends the
 * first snapshot immediately, then one per change, plus a `ping` event every
 * 20 s so the client can tell a quiet queue from a dead connection.
 */
export function sseResponse<T extends { v: number } | object>(
  request: Request,
  sessionId: string,
  initial: SessionData,
  project: (data: SessionData) => T | null,
): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (data: SessionData) => {
        const view = project(data);
        if (view) write(`data: ${JSON.stringify(view)}\n\n`);
      };

      write("retry: 3000\n\n");
      send(initial);
      const unsubscribe = hub.subscribe(sessionId, send);
      const ping = setInterval(() => write(`event: ping\ndata: ${Date.now()}\n\n`), PING_EVERY_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: keeps compression from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** True when the client asked for a one-off JSON snapshot (the polling fallback). */
export function wantsJson(request: Request): boolean {
  return new URL(request.url).searchParams.has("once");
}
