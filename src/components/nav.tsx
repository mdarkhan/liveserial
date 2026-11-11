"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { t } from "@/lib/i18n/bn";
import { cx } from "./ui";

/**
 * Section tabs in one row. On a narrow phone the row scrolls sideways inside
 * itself (the page never does), with the current tab scrolled into view and a
 * fade at the edge hinting that there is more.
 */
export function NavTabs({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  // The most specific matching tab wins ("/console/reports" over "/console").
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeHref]);

  return (
    <nav aria-label={t.nav.sections} className="relative">
      <ul className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] sm:[mask-image:none]">
        {items.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                ref={active ? activeRef : undefined}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-12 items-center rounded-lg px-3 font-medium whitespace-nowrap",
                  active ? "bg-primary text-on-primary" : "text-ink hover:bg-primary-soft",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
        {/* room so the last tab can scroll clear of the fade */}
        <li aria-hidden="true" className="w-6 shrink-0 sm:hidden" />
      </ul>
    </nav>
  );
}
