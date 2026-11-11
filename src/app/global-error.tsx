"use client";

import { t } from "@/lib/i18n/bn";
import "./globals.css";

/**
 * Last resort, when even the root layout fails: a self-contained Bangla page
 * (it replaces the whole document, so it brings its own <html>).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="bn">
      <body className="flex min-h-dvh flex-col">
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 text-center">
          <p className="text-sm font-semibold text-primary">{t.appName}</p>
          <h1 className="mt-2 text-2xl font-bold">{t.common.errorTitle}</h1>
          <p className="mt-2 text-ink-muted">{t.common.errorBody}</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={reset}
              className="min-h-14 rounded-lg bg-primary px-5 text-lg font-semibold text-on-primary"
            >
              {t.common.retry}
            </button>
            {/* A full reload on purpose: the app's own navigation may be what broke. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-flex min-h-14 items-center justify-center rounded-lg border-2 border-line-strong px-5 text-lg font-semibold">
              {t.common.goHome}
            </a>
          </div>
          {error.digest && <p className="mt-6 text-sm text-ink-muted">{t.common.errorRef(error.digest)}</p>}
        </main>
      </body>
    </html>
  );
}
