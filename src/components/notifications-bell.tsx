import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, Activity, FlaskConical, Columns3, PackageOpen, AlertTriangle, FileText, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications.functions";
import { useNavigate } from "@tanstack/react-router";

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  column_eol: Columns3,
  batch_review: PackageOpen,
  run_failed: AlertTriangle,
  run_parsed: Activity,
  calibration_drift: FlaskConical,
  qc_fail: AlertTriangle,
  system: FileText,
  mention: MessageSquare,
};

const KIND_COLORS: Record<string, string> = {
  column_eol: "text-amber-500",
  batch_review: "text-blue-500",
  run_failed: "text-red-500",
  run_parsed: "text-green-500",
  calibration_drift: "text-amber-500",
  qc_fail: "text-red-500",
  system: "text-muted-foreground",
  mention: "text-blue-500",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const qc = useQueryClient();

  const listFn = useServerFn(listNotifications);
  const countFn = useServerFn(getUnreadCount);
  const markReadFn = useServerFn(markNotificationRead);
  const markAllFn = useServerFn(markAllNotificationsRead);

  const { data: countData } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => countFn(),
    refetchInterval: 30_000, // poll every 30s
  });

  const { data: notifications, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listFn(),
    enabled: open,
  });

  const unread = countData?.count ?? 0;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = async (n: any) => {
    if (!n.readAt) {
      await markReadFn({ data: { id: n.id } });
      qc.invalidateQueries({ queryKey: ["notifications-unread"] });
      refetch();
    }
    if (n.link) {
      nav({ to: n.link });
      setOpen(false);
    }
  };

  const handleMarkAll = async () => {
    await markAllFn();
    qc.invalidateQueries({ queryKey: ["notifications-unread"] });
    refetch();
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold">
              Notifications {unread > 0 && `(${unread} unread)`}
            </span>
            {unread > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={handleMarkAll}
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </Button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {!notifications || notifications.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              notifications.map((n: any) => {
                const Icon = KIND_ICONS[n.kind] ?? Bell;
                const color = KIND_COLORS[n.kind] ?? "text-muted-foreground";
                return (
                  <button
                    key={n.id}
                    className={`flex w-full items-start gap-2.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-accent/30 ${
                      !n.readAt ? "bg-accent/10" : ""
                    }`}
                    onClick={() => handleClick(n)}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{n.title}</div>
                      {n.body && (
                        <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                          {n.body}
                        </div>
                      )}
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {timeAgo(n.createdAt)}
                      </div>
                    </div>
                    {!n.readAt && (
                      <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
