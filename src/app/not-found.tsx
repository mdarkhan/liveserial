import { t } from "@/lib/i18n/bn";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 text-center">
      <p className="text-sm font-semibold text-primary">{t.appName}</p>
      <h1 className="mt-2 text-2xl font-bold">{t.patient.notFoundTitle}</h1>
      <p className="mt-2 text-ink-muted">{t.patient.notFoundBody}</p>
    </main>
  );
}
