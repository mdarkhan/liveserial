import { t } from "@/lib/i18n/bn";

/**
 * Shown at once while the next page loads on a slow connection, so a tap
 * visibly did something (no double taps). Grey blocks shaped like a page.
 */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-4 motion-reduce:animate-none">
      <span className="sr-only">{t.common.loading}</span>
      <div className="h-7 w-2/5 rounded-md bg-line" />
      <div className="h-4 w-1/3 rounded-md bg-line" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 rounded-[var(--radius-card)] border border-line bg-surface" />
      ))}
    </div>
  );
}

/** The same, with a thin moving bar on top, for pages without the staff header. */
export function FullPageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <>
      <div aria-hidden="true" className="h-1 w-full overflow-hidden bg-primary-soft">
        <div className="loading-bar h-full w-1/3 bg-primary" />
      </div>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
        <PageSkeleton rows={rows} />
      </div>
    </>
  );
}
