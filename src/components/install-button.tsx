"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui";
import { t } from "@/lib/i18n/bn";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function subscribeStandalone(onChange: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * "হোম স্ক্রিনে যোগ করুন": Android/desktop Chrome get the browser's install
 * prompt; iPhone gets the Safari instructions. Hidden once installed.
 */
export function InstallButton() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => true);
  const ios = useSyncExternalStore(subscribeStandalone, isIos, () => false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // show our own button instead of the browser's mini-bar
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || (!event && !ios)) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-primary/30 bg-primary-soft p-4">
      <p className="min-w-0 flex-1 text-sm">{ios && !event ? t.console.installIos : t.console.installHint}</p>
      {event && (
        <button
          type="button"
          className={buttonClass("primary")}
          onClick={async () => {
            await event.prompt();
            await event.userChoice.catch(() => null);
            setEvent(null);
          }}
        >
          {t.console.install}
        </button>
      )}
    </div>
  );
}
