// Desktop companion watch-folder DELETE endpoint.
// DELETE /api/desktop/watch-folders/:id — deletes a watch folder by id.
// Mirrors the deleteWatchFolder server fn.
import { createFileRoute } from "@tanstack/react-router";
import { requireBearerAuth } from "@/lib/desktop-auth";

export const Route = createFileRoute("/api/desktop/watch-folders/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        let ctx;
        try {
          ctx = await requireBearerAuth(request);
        } catch (e: any) {
          return e instanceof Response ? e : Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        const id = (params as { id: string }).id;
        try {
          await ctx.db.query("delete from public.import_watch_folders where id=$1", [id]);
          return Response.json({ ok: true });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Failed to delete watch folder" }, { status: 500 });
        }
      },
    },
  },
});
