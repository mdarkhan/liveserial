import { t } from "@/lib/i18n/bn";

/**
 * Web app manifest for "add to home screen" (the console opens like an app).
 * Linked only from console pages of organizations with CONSOLE_PWA on
 * (see lib/pwa.ts); the file itself is the same for everyone.
 */
export function GET() {
  return Response.json(
    {
      name: t.appName,
      short_name: t.appName,
      description: t.tagline,
      lang: "bn",
      start_url: "/console",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#0f766e",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
  );
}
