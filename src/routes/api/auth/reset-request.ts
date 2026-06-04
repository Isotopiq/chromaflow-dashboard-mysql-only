import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { issueResetToken } from "@/lib/auth/users.server";
import { sendEmail, appUrl } from "@/lib/email.server";

const Body = z.object({ email: z.string().email().max(254) });

export const Route = createFileRoute("/api/auth/reset-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try { parsed = Body.parse(await request.json()); }
        catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }

        const issued = await issueResetToken(parsed.email);
        // Always respond OK to avoid leaking which emails exist.
        if (issued) {
          const url = `${appUrl()}/reset-password?token=${issued.token}`;
          await sendEmail({
            to: parsed.email,
            subject: "Reset your CHROMA.LAB password",
            html: `
              <p>Hi,</p>
              <p>Click the link below to set a new password. The link expires in 1 hour.</p>
              <p><a href="${url}">${url}</a></p>
              <p>If you didn't request this, you can ignore this email.</p>
            `,
          }).catch((e) => console.error("[reset email]", e));
        }
        return Response.json({ ok: true });
      },
    },
  },
});
