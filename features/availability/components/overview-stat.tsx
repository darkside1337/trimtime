import type { ReactNode } from "react";

export function OverviewStat({
  ariaLabel,
  label,
  value,
  detail,
}: {
  ariaLabel: string;
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <section
      className="rounded-xl border border-border bg-muted/40 p-4"
      aria-label={ariaLabel}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-2xl font-bold tabular-nums">
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}
