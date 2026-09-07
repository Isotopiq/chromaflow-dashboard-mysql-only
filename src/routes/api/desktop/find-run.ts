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
        let ctx;
        try {
          ctx = await requireBearerAuth(request);
        } catch (e: any) {
          return e instanceof Response ? e : Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
        try {
          const result = await findRunByPathInDb(ctx.db, ctx.userId, parsed.filePath);
          return Response.json(result);
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Failed to find run" }, { status: 500 });
        }
      },
    },
  },
});
