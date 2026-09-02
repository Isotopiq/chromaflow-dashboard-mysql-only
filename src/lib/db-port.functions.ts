// Database export / import server functions.
// Export dumps all user data tables to a JSON file.
// Import restores from a previously exported JSON file.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";

// Tables to export, in dependency order (parents before children).
// Excludes system tables (audit_events, notifications, invite_codes)
// and auth tables (app_users, user_roles, profiles) for security.
const EXPORT_TABLES = [
  "columns",
  "column_service_events",
  "column_injections",
  "methods",
  "batches",
  "analytes",
  "analyte_column_rt",
  "compound_lists",
  "compound_list_entries",
  "method_column_list_defaults",
  "runs",
  "peaks",
  "annotations",
  "reports",
  "shared_links",
  "branding_settings",
  "storage_settings",
  "calibration_standards",
  "calibration_curves",
  "qc_samples",
  // V3 tables
  "rt_alignment_runs",
  "is_assignments",
  "sample_queues",
  "sample_queue_entries",
  "method_templates",
  "report_jobs",
  "custom_columns",
  "import_watch_folders",
  "imported_files",
  "nce_optimization",
] as const;

type ExportPayload = {
  version: string;
  exportedAt: string;
  schemaVersion: string;
  tables: Record<string, any[]>;
};

// ---- Export ----
export const exportDatabase = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    const tables: Record<string, any[]> = {};
    for (const table of EXPORT_TABLES) {
      try {
        const rows = await db.many(`select * from public.${table}`);
        tables[table] = rows;
      } catch {
        // Table might not exist in older deployments — skip it
        tables[table] = [];
      }
    }

    const payload: ExportPayload = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      schemaVersion: "v3",
      tables,
    };

    return payload;
  });

// ---- Import ----
const ImportInput = z.object({
  payload: z.any(),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

export const importDatabase = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ImportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db, userId } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const payload = data.payload as ExportPayload;

    if (!payload || !payload.tables) {
      throw new Error("Invalid export file: missing tables data.");
    }

    const results: Record<string, { inserted: number; skipped: number }> = {};

    // In replace mode, delete existing data first (in reverse dependency order)
    if (data.mode === "replace") {
      const reversed = [...EXPORT_TABLES].reverse();
      for (const table of reversed) {
        try {
          await db.query(`delete from public.${table}`);
        } catch {
          // Table might not exist — skip
        }
      }
    }

    // Import in dependency order
    for (const table of EXPORT_TABLES) {
      const rows = payload.tables[table];
      if (!rows || rows.length === 0) {
        results[table] = { inserted: 0, skipped: 0 };
        continue;
      }

      let inserted = 0;
      let skipped = 0;

      for (const row of rows) {
        try {
          // Build insert query dynamically
          const cols = Object.keys(row);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          const values = cols.map((c) => {
            const v = row[c];
            // Convert arrays to PostgreSQL format
            if (Array.isArray(v)) return v;
            // Pass objects as-is (pg handles JSONB)
            return v;
          });

          // Use ON CONFLICT DO NOTHING for merge mode
          const conflictClause = data.mode === "merge"
            ? " on conflict do nothing"
            : "";

          await db.query(
            `insert into public.${table} (${cols.join(", ")}) values (${placeholders})${conflictClause}`,
            values,
          );
          inserted++;
        } catch (e: any) {
          // Skip rows that fail (duplicate keys, missing FKs, etc.)
          skipped++;
        }
      }

      results[table] = { inserted, skipped };
    }

    const totalInserted = Object.values(results).reduce((s, r) => s + r.inserted, 0);
    const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped, 0);

    return { totalInserted, totalSkipped, perTable: results };
  });
