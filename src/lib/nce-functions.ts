// NCE (normalized collision energy) optimization server functions.
//
// These CRUD endpoints back the "NCE optimization" feature: for each analyte
// (optionally tied to a method) a user can record which NCE values were
// tested, the fragment spectra observed, and mark the best NCE + fragment
// count. Data lives in `public.nce_optimization`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";

// ---- Types ----

export type NceOptimization = {
  id: string;
  analyteId: string;
  methodId: string | null;
  nceTested: number | null;
  bestNce: number | null;
  bestFragmentCount: number | null;
  spectraJson: any;
  notes: string;
  createdBy: string | null;
  createdAt: string;
};

function mapNce(r: any): NceOptimization {
  return {
    id: r.id,
    analyteId: r.analyte_id,
    methodId: r.method_id ?? null,
    nceTested: r.nce_tested != null ? Number(r.nce_tested) : null,
    bestNce: r.best_nce != null ? Number(r.best_nce) : null,
    bestFragmentCount: r.best_fragment_count != null ? Number(r.best_fragment_count) : null,
    spectraJson: r.spectra_json ?? [],
    notes: r.notes ?? "",
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
  };
}

// ---- Save (insert) an NCE optimization record ----

const SaveNceInput = z.object({
  analyteId: z.string().uuid(),
  methodId: z.string().uuid().nullable().optional(),
  nceTested: z.number(),
  spectraJson: z.any().default([]),
  notes: z.string().default(""),
});

export const saveNceOptimization = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => SaveNceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    const row = await db.one<any>(
      `insert into public.nce_optimization
         (analyte_id, method_id, nce_tested, spectra_json, notes, created_by)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        data.analyteId,
        data.methodId ?? null,
        data.nceTested,
        JSON.stringify(data.spectraJson ?? []),
        data.notes ?? "",
        userId,
      ],
    );

    return mapNce(row);
  });

// ---- Set the best NCE / fragment count for an existing record ----

const SetBestNceInput = z.object({
  id: z.string().uuid(),
  bestNce: z.number(),
  bestFragmentCount: z.number().int(),
});

export const setBestNce = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => SetBestNceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    const row = await db.one<any>(
      `update public.nce_optimization
          set best_nce = $1, best_fragment_count = $2
        where id = $3
       returning *`,
      [data.bestNce, data.bestFragmentCount, data.id],
    );

    return mapNce(row);
  });

// ---- List all NCE optimization records for an analyte ----

const ListNceInput = z.object({
  analyteId: z.string().uuid(),
});

export const listNceForAnalyte = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ListNceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    const rows = await db.many<any>(
      `select * from public.nce_optimization
        where analyte_id = $1
        order by created_at desc`,
      [data.analyteId],
    );

    return rows.map(mapNce);
  });

// ---- Delete an NCE optimization record ----

const DeleteNceInput = z.object({
  id: z.string().uuid(),
});

export const deleteNceOptimization = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeleteNceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    await db.query(
      "delete from public.nce_optimization where id = $1",
      [data.id],
    );

    return { ok: true };
  });
