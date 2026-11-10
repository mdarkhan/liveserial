"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

/** Section tabs. Wraps onto two lines on small phones instead of scrolling sideways. */
export function NavTabs({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  // The most specific matching tab wins ("/console/reports" over "/console").
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-1">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "inline-flex min-h-12 items-center rounded-lg px-3 font-medium",
              active ? "bg-primary text-white" : "text-ink hover:bg-primary-soft",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
