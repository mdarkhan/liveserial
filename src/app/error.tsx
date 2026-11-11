"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui";
import { t } from "@/lib/i18n/bn";

/**
 * Any page that fails on the server shows this instead of the framework's
 * English error screen: what happened, "try again", and a way home. The digest
 * is a reference the owner can match in the server log.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 text-center">
      <p className="text-sm font-semibold text-primary">{t.appName}</p>
      <h1 className="mt-2 text-2xl font-bold">{t.common.errorTitle}</h1>
      <p className="mt-2 text-ink-muted">{t.common.errorBody}</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={reset} className={buttonClass("primary", "lg")}>
          {t.common.retry}
        </button>
        <Link href="/" className={buttonClass("secondary", "lg")}>
          {t.common.goHome}
        </Link>
      </div>
      {error.digest && <p className="mt-6 text-sm text-ink-muted">{t.common.errorRef(error.digest)}</p>}
    </main>
  );
}
