import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";
import { useAuth } from "@/lib/auth-context";
import { useLab } from "@/lib/store";
import { loadCore, loadRuns } from "@/lib/lab.functions";

export const Route = createFileRoute("/_shell")({
  component: ShellLayout,
});

function ShellLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const setAll = useLab((s) => s.setAll);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [user, loading, nav]);

  // Core data: fast — small tables (methods, columns, batches, analytes, etc.)
  // Shell renders as soon as this is available.
  const fetchCore = useServerFn(loadCore);
  const { data: core, isLoading: coreLoading } = useQuery({
    queryKey: ["lab-core", user?.id ?? "anon"],
    queryFn: () => fetchCore(),
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });

  // Runs data: slower — runs + peaks + V3 tables. Loads in the background
  // after the shell is already rendered.
  const fetchRuns = useServerFn(loadRuns);
  const { data: runs } = useQuery({
    queryKey: ["lab-runs", user?.id ?? "anon"],
    queryFn: () => fetchRuns(),
    enabled: !!user,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });

  // Merge core + runs into the Zustand store as they arrive.
  useEffect(() => {
    if (core && runs) {
      setAll({ ...core, ...runs } as any);
    } else if (core) {
      // Shell can render with core data alone; runs tables default to [].
      setAll({ ...core, runs: [], injections: [], isAssignments: [], sampleQueues: [], methodTemplates: [], reportJobs: [], customColumns: [], importWatchFolders: [], nceOptimizations: [], bufferExchangeEvents: [], qcRuns: [], anomalyChecks: [] } as any);
    }
  }, [core, runs, setAll]);

  if (loading || (!user && !loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-x-hidden">
            {coreLoading && !core ? (
              <div className="p-6 text-xs text-muted-foreground">Loading lab data…</div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
