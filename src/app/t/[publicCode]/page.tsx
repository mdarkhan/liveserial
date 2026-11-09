import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { bn } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { loadSessionData, projectPatient, sessionIdForCode } from "@/lib/snapshot";
import { PatientLive } from "./patient-live";

/** One lookup per request, shared by generateMetadata and the page. */
const load = cache(async (code: string) => {
  const sessionId = await sessionIdForCode(code);
  const data = sessionId ? await loadSessionData(sessionId) : null;
  return data ? projectPatient(data, code) : null;
});

export async function generateMetadata({ params }: PageProps<"/t/[publicCode]">): Promise<Metadata> {
  const view = await load((await params).publicCode);
  return {
    title: view ? `${t.patient.title(bn(view.you.serial))} · ${view.session.doctorName}` : t.patient.notFoundTitle,
    // Patient links are private: keep them out of search engines and referrers.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * Patient page. Server-rendered with the current state (useful even before
 * JavaScript loads), then kept live by a small client component.
 */
export default async function PatientPage({ params }: PageProps<"/t/[publicCode]">) {
  const { publicCode } = await params;
  const view = await load(publicCode);
  if (!view) notFound();
  return <PatientLive code={publicCode} initial={view} />;
}
