// Report email and status functions — kept separate from v3-functions.ts
// to avoid pulling nodemailer into client-side bundles.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import { mapReportJob } from "@/lib/lab-data.server";
import { sendEmail } from "@/lib/email.server";

const SendReportEmailInput = z.object({
  id: z.string().uuid(),
  to: z.array(z.string().email()),
  subject: z.string().default(""),
  body: z.string().default(""),
});

export const sendReportEmail = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => SendReportEmailInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const job = await db.one<any>(
      "select * from public.report_jobs where id=$1", [data.id],
    );
    if (!job.storage_path) throw new Error("Report file not found.");

    try {
      const toStr = data.to.join(", ");
      await sendEmail({
        to: toStr,
        subject: data.subject || job.title,
        html: data.body || `<p>Report: ${job.title}</p>`,
        text: data.body || `Report: ${job.title}`,
      });
      await db.query(
        "update public.report_jobs set email_sent_at=now(), email_to=$1, status='sent' where id=$2",
        [data.to, data.id],
      );
      return { ok: true };
    } catch (e: any) {
      await db.query(
        "update public.report_jobs set status='failed' where id=$1", [data.id],
      );
      throw new Error(`Email send failed: ${e?.message ?? "unknown error"}`);
    }
  });

const UpdateReportStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending","generating","ready","sent","failed"]),
  storagePath: z.string().nullable().optional(),
});

export const updateReportStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => UpdateReportStatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const row = await db.one<any>(
      `update public.report_jobs set status=$1, storage_path=coalesce($2, storage_path)
       where id=$3 returning *`,
      [data.status, data.storagePath ?? null, data.id],
    );
    return mapReportJob(row);
  });
