"use client";

/**
 * Small sounds made with Web Audio (no audio files to download).
 * Browsers only allow sound after the user has tapped the page once, so pages
 * call `unlockAudio()` from a button press and then play freely.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

/** Call from a click/tap handler. Returns false if this browser can't play sound. */
export async function unlockAudio(): Promise<boolean> {
  const a = audio();
  if (!a) return false;
  try {
    if (a.state === "suspended") await a.resume();
    // A silent blip: iOS only unlocks after something actually plays.
    tone(a, 440, a.currentTime, 0.01, 0.0001);
    return a.state === "running";
  } catch {
    return false;
  }
}

export function audioReady(): boolean {
  return ctx?.state === "running";
}

function tone(a: AudioContext, freq: number, at: number, length: number, volume = 0.35) {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(a.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

/** "Ding-dong" for the waiting-room TV. Resolves when it has finished. */
export function playChime(): Promise<void> {
  const a = audio();
  if (!a || a.state !== "running") return Promise.resolve();
  const t = a.currentTime + 0.02;
  tone(a, 880, t, 0.9);
  tone(a, 660, t + 0.45, 1.1);
  return new Promise((r) => setTimeout(r, 1600));
}

/** Short repeated beeps for the patient's phone (urgent = more beeps). */
export function playAlert(urgent: boolean) {
  const a = audio();
  if (a && a.state === "running") {
    const t = a.currentTime + 0.02;
    const n = urgent ? 4 : 2;
    for (let i = 0; i < n; i++) tone(a, 988, t + i * 0.32, 0.22, 0.5);
  }
  navigator.vibrate?.(urgent ? [300, 150, 300, 150, 300] : [200, 100, 200]);
}
