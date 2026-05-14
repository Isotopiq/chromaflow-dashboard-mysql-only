import { useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createShareLink } from "@/lib/lab.functions";

const EXPIRY_OPTIONS = [
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
  { label: "1 year", hours: 24 * 365 },
];

export function ShareDialog({
  resourceKind,
  resourceId,
  trigger,
}: {
  resourceKind: "run" | "report";
  resourceId: string;
  trigger: ReactNode;
}) {
  const create = useServerFn(createShareLink);
  const [hours, setHours] = useState(24 * 7);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onGenerate = async () => {
    setBusy(true);
    try {
      const { token } = await create({
        data: { resourceKind, resourceId, expiresInHours: hours },
      });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setUrl(`${origin}/shared/${token}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create link");
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setUrl(null);
          setCopied(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {resourceKind}</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this {resourceKind} read-only until it expires.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Expires in</span>
            <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((o) => (
                  <SelectItem key={o.hours} value={String(o.hours)} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {url && (
            <div className="flex items-center gap-2">
              <Input value={url} readOnly className="h-8 font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={onCopy}>
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onGenerate} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {url ? "Regenerate" : "Create link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
