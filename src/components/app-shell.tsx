import type { ReactNode } from "react";
import { logoutAction } from "@/app/login/actions";
import type { SessionUser } from "@/lib/access";
import { t } from "@/lib/i18n/bn";
import { NavTabs } from "./nav";

/**
 * Staff page frame: one compact row (app name, organization · user, logout),
 * then the section tabs in a single row. Kept short so the page's own content
 * starts high on a phone.
 */
export function AppShell({
  user,
  nav,
  children,
}: {
  user: SessionUser;
  nav?: Array<{ href: string; label: string }>;
  children: ReactNode;
}) {
  const who = `${user.organization?.name ?? t.roles.SUPER_ADMIN} · ${user.name} (${t.roles[user.role]})`;
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 pt-1.5 pb-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold leading-tight text-primary">{t.appName}</p>
            <p className="truncate text-sm leading-tight text-ink-muted" title={who}>
              {who}
            </p>
          </div>
          <form action={logoutAction} className="shrink-0">
            <button type="submit" className="min-h-12 rounded-lg px-3 font-medium text-ink-muted hover:bg-canvas">
              {t.common.logout}
            </button>
          </form>
        </div>
        {nav && (
          <div className="mx-auto max-w-5xl px-3 pb-1.5">
            <NavTabs items={nav} />
          </div>
        )}
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 outline-none">
        {children}
      </main>
    </>
  );
}
