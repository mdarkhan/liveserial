import type { Metadata } from "next";
import { getSessionUser } from "@/lib/access";
import { resolveFeatures } from "@/lib/features";
import { t } from "@/lib/i18n/bn";

/** Is "install on home screen" switched on for the signed-in user's organization? */
export async function pwaEnabled(): Promise<boolean> {
  const user = await getSessionUser();
  return !!user?.organization && resolveFeatures(user.organization.features).CONSOLE_PWA;
}

/** Console page metadata, plus the manifest + iOS home-screen tags when installing is on. */
export async function consoleMetadata(title: string): Promise<Metadata> {
  if (!(await pwaEnabled())) return { title };
  return {
    title,
    manifest: "/app.webmanifest",
    appleWebApp: { capable: true, title: t.appName, statusBarStyle: "default" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}
