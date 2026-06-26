import { createFileRoute, Link } from "@tanstack/react-router";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, GitBranch } from "lucide-react";

export const Route = createFileRoute("/_shell/methods/$methodId/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const { methodId } = Route.useParams();
  const { methods, runs, hydrated } = useLab();
  const method = methods.find((m) => m.id === methodId);

  if (!method) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Link to="/methods" className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> All methods
        </Link>
        <Card className="border-border bg-card p-6 text-sm">
          {hydrated ? "Method not found." : "Loading method…"}
        </Card>
      </div>
    );
  }

  const methodRuns = runs.filter((r) => r.methodId === method.id);
  const events = [
    { ts: method.createdAt, label: "Method created", kind: "created" as const },
    ...(method.updatedAt && method.updatedAt !== method.createdAt
      ? [{ ts: method.updatedAt, label: "Last updated", kind: "updated" as const }]
      : []),
    ...methodRuns.map((r) => ({
      ts: r.acquiredAt ?? r.createdAt,
      label: `Run linked — ${r.name}`,
      kind: "run" as const,
    })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link to="/methods/$methodId" params={{ methodId }} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to method
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GitBranch className="h-5 w-5" /> Revision history
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{method.name}</p>
      </div>

      <Card className="border-border bg-card p-5">
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground">No history yet.</div>
        ) : (
          <ol className="relative ml-3 border-l border-border">
            {events.map((e, i) => (
              <li key={i} className="mb-5 ml-4">
                <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-border bg-card" />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <time className="font-mono">{new Date(e.ts).toLocaleString()}</time>
                  <Badge variant="outline" className="text-[10px] capitalize">{e.kind}</Badge>
                </div>
                <div className="text-sm">{e.label}</div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
