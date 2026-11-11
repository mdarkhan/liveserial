import type { Metadata, Viewport } from "next";
import { Hind_Siliguri } from "next/font/google";
import { t } from "@/lib/i18n/bn";
import "./globals.css";

const bangla = Hind_Siliguri({
  variable: "--font-bangla",
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: t.appName, template: `%s · ${t.appName}` },
  description: t.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0f766e" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

// Everything in this app is live, per-request data.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bn" className={`${bangla.variable} h-full antialiased`}>
      <body className="min-h-dvh flex flex-col">
        {/* Keyboard users jump past the header and tabs straight to the page. */}
        <a href="#main" className="skip-link">
          {t.common.skipToMain}
        </a>
        {children}
      </body>
    </html>
  );
}
