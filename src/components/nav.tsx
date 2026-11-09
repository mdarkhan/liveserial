"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

/** Section tabs. Wraps onto two lines on small phones instead of scrolling sideways. */
export function NavTabs({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-1">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
