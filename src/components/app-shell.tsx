import type { ReactNode } from "react";
import { logoutAction } from "@/app/login/actions";
import type { SessionUser } from "@/lib/access";
import { t } from "@/lib/i18n/bn";
import { NavTabs } from "./nav";

/** Staff page frame: header with org + user + logout, optional section tabs. */
export function AppShell({
  user,
  nav,
  children,
}: {
  user: SessionUser;
  nav?: Array<{ href: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0">
            <p className="font-bold text-primary">{t.appName}</p>
            <p className="truncate text-sm text-ink-muted">
              {user.organization?.name ?? t.roles.SUPER_ADMIN} · {user.name} ({t.roles[user.role]})
            </p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="min-h-12 rounded-lg px-3 font-medium text-ink-muted hover:bg-canvas">
              {t.common.logout}
            </button>
          </form>
        </div>
        {nav && (
          <div className="mx-auto max-w-5xl px-3 pb-2">
            <NavTabs items={nav} />
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">{children}</main>
    </>
  );
}
