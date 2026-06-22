import { Check, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function SaveStatus({
  state,
  lastSavedAt,
  className,
}: {
  state: SaveState;
  lastSavedAt?: number | null;
  className?: string;
}) {
  let icon: React.ReactNode = null;
  let text = "";
  let tone = "text-muted-foreground";
  switch (state) {
    case "saving":
      icon = <Loader2 className="h-3 w-3 animate-spin" />;
      text = "Saving…";
      break;
    case "saved":
      icon = <Check className="h-3 w-3" />;
      text = lastSavedAt ? `Saved ${formatAgo(lastSavedAt)}` : "Saved";
      tone = "text-emerald-500";
      break;
    case "error":
      icon = <AlertCircle className="h-3 w-3" />;
      text = "Save failed";
      tone = "text-destructive";
      break;
    default:
      if (lastSavedAt) {
        icon = <Check className="h-3 w-3" />;
        text = `Saved ${formatAgo(lastSavedAt)}`;
      } else {
        text = "Not saved yet";
      }
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", tone, className)}>
      {icon}
      {text}
    </span>
  );
}

function formatAgo(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}
