import { AppShell } from "@/components/app-shell";
import { requireOrgUser } from "@/lib/access";
import { resolveFeatures } from "@/lib/features";
import { t } from "@/lib/i18n/bn";

const nav = [
  { href: "/admin/sessions", label: t.nav.sessions },
  { href: "/admin/reports", label: t.nav.reports },
  { href: "/admin/doctors", label: t.nav.doctors },
  { href: "/admin/chambers", label: t.nav.chambers },
  { href: "/admin/schedules", label: t.nav.schedules },
  { href: "/admin/users", label: t.nav.users },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const { user } = await requireOrgUser(["ORG_ADMIN"]);
  // "SMS খরচ" only where the super admin switched the SMS cost preview on.
  const items = resolveFeatures(user.organization?.features).SMS_COST_PREVIEW
    ? [...nav, { href: "/admin/sms", label: t.nav.smsCost }]
    : nav;
  return (
    <AppShell user={user} nav={items}>
      {children}
    </AppShell>
  );
}
