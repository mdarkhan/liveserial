import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { buttonClass, EmptyState, List, ListItem, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/access";
import { bn, dhakaDateString } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { getSmsUsage } from "@/lib/reports";
import { superNav } from "../super-nav";

export const metadata: Metadata = { title: t.smsUsage.title };

const monthFmt = new Intl.DateTimeFormat("bn-BD", { month: "long", year: "numeric", timeZone: "UTC" });

/** SMS per organization for one month, for billing. */
export default async function SmsUsagePage({ searchParams }: PageProps<"/super/sms">) {
  const user = await requireUser(["SUPER_ADMIN"]);
  const thisMonth = dhakaDateString().slice(0, 7);
  const q = await searchParams;
  const month = typeof q.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month) ? q.month : thisMonth;
  const rows = await getSmsUsage(month);
  const sum = (k: "sent" | "sentSegments" | "failed" | "pending") => rows.reduce((a, r) => a + r[k], 0);
  const u = t.smsUsage;

  return (
    <AppShell user={user} nav={superNav}>
      <PageHeader title={u.title} subtitle={monthFmt.format(new Date(`${month}-01T00:00:00Z`))} />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="flex-1 sm:flex-none">
          <span className="mb-1 block font-medium">{u.month}</span>
          <input
            type="month"
            name="month"
            defaultValue={month}
            max={thisMonth}
            className="block min-h-12 w-full rounded-lg border-2 border-line-strong bg-surface px-3"
          />
        </label>
        <button type="submit" className={buttonClass("secondary")}>
          {u.show}
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>{u.empty}</EmptyState>
      ) : (
        <List>
          {rows.map((r) => (
            <ListItem key={r.orgId}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.name}</p>
                <p className="font-mono text-sm text-ink-muted">{r.slug}</p>
              </div>
              <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1 text-sm sm:w-auto sm:grid-cols-4">
                <div>
                  <dt className="text-ink-muted">{u.segments}</dt>
                  <dd className="tabular text-lg font-bold text-primary">{bn(r.sentSegments)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">{u.sent}</dt>
                  <dd className="tabular text-lg font-bold">{bn(r.sent)}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">{u.failed}</dt>
                  <dd className={r.failed ? "tabular text-lg font-bold text-danger" : "tabular text-lg font-bold"}>
                    {bn(r.failed)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">{u.pending}</dt>
                  <dd className="tabular text-lg font-bold">{bn(r.pending)}</dd>
                </div>
              </dl>
            </ListItem>
          ))}
          <ListItem className="bg-canvas">
            <p className="min-w-0 flex-1 font-bold">{u.total}</p>
            <p className="tabular font-bold">
              {u.segments}: {bn(sum("sentSegments"))} · {u.sent}: {bn(sum("sent"))} · {u.failed}: {bn(sum("failed"))}
            </p>
          </ListItem>
        </List>
      )}
      <p className="mt-4 text-sm text-ink-muted">{u.note}</p>
    </AppShell>
  );
}
