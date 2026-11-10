import { cx } from "@/components/ui";
import { bn } from "@/lib/format";
import { t } from "@/lib/i18n/bn";
import { smsSegments } from "@/lib/sms-text";

/**
 * "৮৪ অক্ষর · ২ ভাগে যাবে" for an SMS text, highlighted when it needs more than
 * one billable part (Bangla: 70 characters in one part, 67 per part beyond).
 */
export function SmsCost({ text, label, className }: { text: string; label?: string; className?: string }) {
  const info = smsSegments(text);
  const many = info.segments > 1;
  return (
    <p
      className={cx(
        "rounded-lg border px-3 py-2 text-sm font-medium",
        many ? "border-warning/40 bg-warning-soft text-warning-ink" : "border-line bg-canvas text-ink-muted",
        className,
      )}
    >
      {label && <span className="block">{label}</span>}
      <span className="tabular">{t.smsCost.line(bn(info.length), bn(info.segments))}</span>
      {many && <span className="mt-0.5 block">{t.smsCost.over}</span>}
    </p>
  );
}
