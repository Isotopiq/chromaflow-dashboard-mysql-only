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
  "buffer_exchange_events",
  "qc_runs",
  "anomaly_checks",
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

// Columns that are FK references to app_users(id). When importing from
// another deployment (e.g. V2 → V3), these user IDs won't exist in the
// target database because app_users is not exported for security reasons.
// We remap non-existent user IDs to the current importing user.
const USER_FK_COLUMNS = new Set([
  "created_by", "uploaded_by", "owner_id", "performed_by",
  "annotated_by", "resolved_by", "actor_id", "updated_by",
]);

// Columns that are JSONB. The pg driver serializes JS arrays as Postgres
// array literals (e.g. {1,2,3}), which is invalid for JSONB columns. We
// must JSON.stringify these values so PostgreSQL parses them as JSON.
const JSONB_COLUMN_SUFFIXES = [
  "_json", "_jsonb", "_trend", "_blob", "_values", "_spectra",
  "_components", "_metrics", "_shift",
];
const JSONB_EXACT_COLUMNS = new Set([
  "summary_json", "diff", "gradient_json", "ms_params_json",
  "ms_scans_json", "pressure_trend", "custom_values",
  "template_json", "components_json", "spectra_json",
  "metrics_json", "shift_json",
]);

function isJsonbColumn(col: string): boolean {
  if (JSONB_EXACT_COLUMNS.has(col)) return true;
  return JSONB_COLUMN_SUFFIXES.some((s) => col.endsWith(s));
}

export const importDatabase = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ImportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db, userId } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const payload = data.payload as ExportPayload;

    if (!payload || !payload.tables) {
      throw new Error("Invalid export file: missing tables data.");
    }

    // Collect all user IDs referenced in the export
    const referencedUserIds = new Set<string>();
    for (const table of EXPORT_TABLES) {
      const rows = payload.tables[table];
      if (!rows) continue;
      for (const row of rows) {
        for (const col of Object.keys(row)) {
          if (USER_FK_COLUMNS.has(col) && row[col]) {
            referencedUserIds.add(String(row[col]));
          }
        }
      }
    }

    // Check which user IDs exist in the target database
    const validUserIds = new Set<string>();
    if (referencedUserIds.size > 0) {
      try {
        const existingUsers = await db.many<{ id: string }>(
          `select id from public.app_users where id = any($1::uuid[])`,
          [[...referencedUserIds]],
        );
        for (const u of existingUsers) validUserIds.add(u.id);
      } catch {
        // If app_users query fails, all user FKs will be remapped
      }
    }

    // Remap function: replace non-existent user IDs with current user
    const remapUser = (val: any): any => {
      if (val == null) return null;
      const sid = String(val);
      if (validUserIds.has(sid)) return val;
      return userId; // remap to current importing user
    };

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

    // Import in dependency order.
    // Each row insert is wrapped in a SAVEPOINT so that a failure on one
    // row does not abort the entire transaction (which would cause all
    // subsequent inserts to fail with "current transaction is aborted").
    for (const table of EXPORT_TABLES) {
      const rows = payload.tables[table];
      if (!rows || rows.length === 0) {
        results[table] = { inserted: 0, skipped: 0 };
        continue;
      }

      let inserted = 0;
      let skipped = 0;

      for (const row of rows) {
        // Use a savepoint so this row can fail without aborting the transaction
        await db.query(`savepoint imp_row`);
        try {
          const cols = Object.keys(row);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          const values = cols.map((c) => {
            const v = row[c];
            // Remap user FK columns to current user if original doesn't exist
            if (USER_FK_COLUMNS.has(c)) return remapUser(v);
            // JSONB columns: stringify arrays/objects so pg sends valid JSON
            if (isJsonbColumn(c) && (Array.isArray(v) || (v !== null && typeof v === "object"))) {
              return JSON.stringify(v);
            }
            // Pass primitives as-is
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
          // Roll back to the savepoint so the transaction stays usable
          await db.query(`rollback to savepoint imp_row`);
          skipped++;
        }
      }

      results[table] = { inserted, skipped };
    }

    const totalInserted = Object.values(results).reduce((s, r) => s + r.inserted, 0);
    const totalSkipped = Object.values(results).reduce((s, r) => s + r.skipped, 0);

    return { totalInserted, totalSkipped, perTable: results };
  });
