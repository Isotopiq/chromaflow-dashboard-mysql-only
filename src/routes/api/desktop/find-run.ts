// Desktop companion find-run-by-path endpoint.
// Used for dedup — check if a file has already been uploaded before re-uploading.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearerAuth } from "@/lib/desktop-auth";
import { findRunByPathInDb } from "@/lib/lab-data.server";

const Body = z.object({
  filePath: z.string().min(1).max(500),
});

export const Route = createFileRoute("/api/desktop/find-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await requireBearerAuth(request, async (ctx) => {
            let parsed;
            try {
              parsed = Body.parse(await request.json());
            } catch {
              return Response.json({ error: "Invalid request body" }, { status: 400 });
            }
            const result = await findRunByPathInDb(ctx.db, ctx.userId, parsed.filePath);
            return Response.json(result);
          });
        } catch (e: any) {
          if (e instanceof Response) return e;
          return Response.json({ error: e?.message ?? "Failed to find run" }, { status: 500 });
        }
      },
    },
  },
});
