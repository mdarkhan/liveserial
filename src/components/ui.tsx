import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Tiny className joiner. */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ───────────── Buttons ─────────────

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "md" | "lg" | "xl";

const variantClass: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover active:bg-primary-hover",
  secondary: "bg-surface text-ink border-2 border-line-strong hover:bg-canvas",
  danger: "bg-surface text-danger border-2 border-danger hover:bg-danger-soft",
  ghost: "text-primary hover:bg-primary-soft",
};
const sizeClass: Record<Size, string> = {
  md: "min-h-12 px-4 text-base",
  lg: "min-h-14 px-5 text-lg",
  xl: "min-h-16 px-6 text-xl",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    variantClass[variant],
    sizeClass[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ───────────── Layout ─────────────

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link
          href={back.href}
          className="mb-2 -ml-2 inline-flex min-h-12 items-center gap-1 rounded-lg px-2 font-medium text-primary hover:bg-primary-soft"
        >
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5", className)}
      {...props}
    />
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-lg font-semibold">{children}</h2>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-line-strong/50 bg-surface p-6 text-center text-ink-muted">
      {children}
    </p>
  );
}

// ───────────── Status ─────────────

type Tone = "neutral" | "primary" | "success" | "warning" | "danger";
const toneClass: Record<Tone, string> = {
  neutral: "bg-canvas text-ink-muted border-line",
  primary: "bg-primary-soft text-primary border-primary/30",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning-ink border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
};

/** Status label: always text, color is only a supplement. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap",
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Alert({ tone = "danger", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3", toneClass[tone])}>
      {children}
    </div>
  );
}

// ───────────── Lists ─────────────

/** Mobile-first list: each row is a card-like item, no horizontal scrolling. */
export function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line bg-surface">{children}</ul>;
}

export function ListItem({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", className)}>{children}</li>;
}
