import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { t } from "@/lib/i18n/bn";
import { loadSessionData, projectDisplay } from "@/lib/snapshot";
import { DisplayLive } from "./display-live";

export const metadata: Metadata = {
  title: t.display.nowServing,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Waiting-room TV / tablet. Public by its unguessable session id; serial numbers only. */
export default async function DisplayPage({ params }: PageProps<"/display/[sessionId]">) {
  const { sessionId } = await params;
  const data = UUID.test(sessionId) ? await loadSessionData(sessionId) : null;
  if (!data) notFound();
  return <DisplayLive sessionId={sessionId} initial={projectDisplay(data)} />;
}
