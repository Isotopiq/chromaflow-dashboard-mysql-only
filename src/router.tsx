import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preloaded route data/chunks stay fresh for 30s — avoids re-preloading
    // the same chunk on repeated hovers within a short window.
    defaultPreloadStaleTime: 30_000,
    defaultPreload: "intent",
    // Show a pending component after 200ms if the route chunk is still
    // loading, giving instant visual feedback instead of a blank screen.
    defaultPendingMs: 200,
    // Keep the pending component visible for at least 300ms to avoid
    // a flash-of-content on fast loads.
    defaultPendingMinMs: 300,
    defaultPendingComponent: () => (
      <div className="flex min-h-[50vh] items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    ),
  });

  return router;
};
