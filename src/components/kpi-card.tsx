import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  delta,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: string;
  icon?: LucideIcon;
  tone?: "default" | "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "ok"
      ? "text-[color:var(--status-ok)]"
      : tone === "warn"
        ? "text-[color:var(--status-warn)]"
        : tone === "bad"
          ? "text-[color:var(--status-bad)]"
          : "text-muted-foreground";
  return (
    <Card className="relative overflow-hidden border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {Icon && <Icon className={cn("h-4 w-4", toneClass)} />}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tracking-tight">{value}</div>
      {delta && <div className={cn("mt-1 text-[11px]", toneClass)}>{delta}</div>}
    </Card>
  );
}
