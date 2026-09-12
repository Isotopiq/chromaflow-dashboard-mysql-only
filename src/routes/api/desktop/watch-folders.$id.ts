// Desktop companion watch-folder DELETE endpoint.
// DELETE /api/desktop/watch-folders/:id — deletes a watch folder by id.
// Mirrors the deleteWatchFolder server fn.
import { createFileRoute } from "@tanstack/react-router";
import { requireBearerAuth } from "@/lib/desktop-auth";

export const Route = createFileRoute("/api/desktop/watch-folders/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          return await requireBearerAuth(request, async (ctx) => {
            const id = (params as { id: string }).id;
            await ctx.db.query(
              "delete from public.import_watch_folders where id=$1 and created_by=$2",
              [id, ctx.userId],
            );
            return Response.json({ ok: true });
          });
        } catch (e: any) {
          if (e instanceof Response) return e;
          return Response.json({ error: e?.message ?? "Failed to delete watch folder" }, { status: 500 });
        }
      },
    },
  },
});
