import { AppShell } from "@/components/app-shell";
import { requireOrgUser } from "@/lib/access";
import { t } from "@/lib/i18n/bn";

const nav = [
  { href: "/admin/sessions", label: t.nav.sessions },
  { href: "/admin/doctors", label: t.nav.doctors },
  { href: "/admin/chambers", label: t.nav.chambers },
  { href: "/admin/schedules", label: t.nav.schedules },
  { href: "/admin/users", label: t.nav.users },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user } = await requireOrgUser(["ORG_ADMIN"]);
  return (
    <AppShell user={user} nav={nav}>
      {children}
    </AppShell>
  );
}
