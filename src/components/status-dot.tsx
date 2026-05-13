import { cn } from "@/lib/utils";

export function StatusDot({
  status,
  className,
}: {
  status: "healthy" | "warn" | "expired" | "validated" | "draft" | "archived" | "in_progress" | "complete" | "review";
  className?: string;
}) {
  const map: Record<string, string> = {
    healthy: "bg-[color:var(--status-ok)]",
    validated: "bg-[color:var(--status-ok)]",
    complete: "bg-[color:var(--status-ok)]",
    warn: "bg-[color:var(--status-warn)]",
    in_progress: "bg-[color:var(--status-warn)]",
    review: "bg-[color:var(--status-warn)]",
    draft: "bg-muted-foreground",
    archived: "bg-muted-foreground",
    expired: "bg-[color:var(--status-bad)]",
  };
  return (
    <span className={cn("inline-block h-2 w-2 rounded-full", map[status] ?? "bg-muted", className)} />
  );
}
