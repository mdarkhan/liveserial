"use client";

/**
 * Bangla announcement of a called serial on the waiting-room TV:
 * "সিরিয়াল বারো, ভেতরে আসুন".
 *
 * 1. Recorded audio, if the clinic has put the files in public/audio/bn/:
 *      serial.mp3 ("সিরিয়াল"), 1.mp3 … 999.mp3 (the numbers), enter.mp3 ("ভেতরে আসুন")
 *    They play one after another.
 * 2. Otherwise the device's own Bangla voice (speechSynthesis), where it has one.
 * 3. Otherwise nothing (the chime still plays).
 */

const BASE = "/audio/bn";
const known = new Map<string, Promise<boolean>>();

function exists(url: string): Promise<boolean> {
  let p = known.get(url);
  if (!p) {
    p = fetch(url, { method: "HEAD" })
      .then((r) => r.ok && (r.headers.get("content-type") ?? "").startsWith("audio"))
      .catch(() => false);
    known.set(url, p);
  }
  return p;
}

function playFile(url: string): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    const done = () => resolve();
    a.addEventListener("ended", done, { once: true });
    a.addEventListener("error", done, { once: true });
    a.play().catch(done);
    setTimeout(done, 8000); // never hang the queue of announcements
  });
}

function banglaVoice(): Promise<SpeechSynthesisVoice | null> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve(null);
  const pick = () => speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("bn")) ?? null;
  const now = pick();
  if (now || speechSynthesis.getVoices().length > 0) return Promise.resolve(now);
  // Voices load asynchronously on some browsers.
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(pick()), 1500);
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(t);
        resolve(pick());
      },
      { once: true },
    );
  });
}

function speak(text: string, voice: SpeechSynthesisVoice): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.9;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setTimeout(resolve, 8000);
  });
}

/** How this device will announce: for the TV's status line. */
export async function announceMethod(): Promise<"recorded" | "voice" | "none"> {
  if ((await exists(`${BASE}/serial.mp3`)) && (await exists(`${BASE}/enter.mp3`))) return "recorded";
  return (await banglaVoice()) ? "voice" : "none";
}

/** Announces `serial`; `text` is the spoken sentence for the voice fallback. */
export async function announceSerial(serial: number, text: string): Promise<void> {
  const files = [`${BASE}/serial.mp3`, `${BASE}/${serial}.mp3`, `${BASE}/enter.mp3`];
  const have = await Promise.all(files.map(exists));
  if (have.every(Boolean)) {
    for (const f of files) await playFile(f);
    return;
  }
  const voice = await banglaVoice();
  if (voice) await speak(text, voice);
}
