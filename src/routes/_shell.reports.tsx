import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import type { Analyte } from "@/lib/mock-data";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { PeakTable } from "@/components/peak-table";
import { FileText, Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  createReport,
  createUploadUrl,
  getReportSignedUrl,
  getRunEICBatch,
  listReports,
} from "@/lib/lab.functions";
import { renderReportPdf } from "@/lib/pdf-report";
import { ShareDialog } from "@/components/share-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/_shell/reports")({
  component: Reports,
});

function Reports() {
  const { runs, methods, analytes } = useLab();
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [sections, setSections] = useState({
    method: true,
    chromatogram: true,
    peaks: true,
    eics: true,
    notes: true,
  });
  const [selectedEicIds, setSelectedEicIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  const method = methods.find((m) => m.id === methodId);
  const methodRun = runs.find((r) => r.methodId === methodId);

  const uploadFn = useServerFn(createUploadUrl);
  const createReportFn = useServerFn(createReport);
  const listReportsFn = useServerFn(listReports);
  const getReportUrlFn = useServerFn(getReportSignedUrl);
  const getEicBatchFn = useServerFn(getRunEICBatch);
  const qc = useQueryClient();

  const reportsQuery = useQuery({
    queryKey: ["reports"],
    queryFn: () => listReportsFn(),
  });

  const eicCandidates = useMemo(
    () => analytes.filter((a: Analyte) => Number.isFinite(a.mz) && a.mz > 0),
    [analytes],
  );
  const selectedEicAnalytes = useMemo(
    () => eicCandidates.filter((a: Analyte) => selectedEicIds.has(a.id)),
    [eicCandidates, selectedEicIds],
  );

  const hasScans = !!methodRun?.scansBlobPath;
  const eicQuery = useQuery({
    queryKey: [
      "report-eics",
      methodRun?.id,
      selectedEicAnalytes.map((a) => a.id).join(","),
    ],
    enabled: hasScans && sections.eics && selectedEicAnalytes.length > 0,
    queryFn: () =>
      getEicBatchFn({
        data: {
          runId: methodRun!.id,
          ppm: 10,
          targets: selectedEicAnalytes.map((a) => ({ id: a.id, mz: a.mz })),
        },
      }),
  });


  const generate = async () => {
    if (!printRef.current || !method) return;
    setBusy(true);
    try {
      const blob = await renderReportPdf(printRef.current);
      const filename = `${method.name.replace(/\s+/g, "_")}.pdf`;
      let up;
      try {
        up = await uploadFn({ data: { filename, bucket: "reports" } });
      } catch (e: any) {
        const msg = e?.message ?? "";
        if (/bucket.*not.*found|not_found/i.test(msg)) {
          throw new Error(
            "Reports storage bucket missing. Re-run the Phase 3 SQL migration to create it.",
          );
        }
        throw e;
      }
      const putRes = await fetch(up.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: blob,
      });
      if (!putRes.ok) {
        const detail = await putRes.text().catch(() => "");
        throw new Error(
          `Upload failed (${putRes.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
        );
      }
      await createReportFn({
        data: {
          title: method.name,
          template: "method",
          runIds: methodRun ? [methodRun.id] : [],
          storagePath: up.path,
        },
      });
      toast.success("Report saved");
      qc.invalidateQueries({ queryKey: ["reports"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate PDF");
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = async (id: string, title: string) => {
    try {
      const { url } = await getReportUrlFn({ data: { id } });
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.download = `${title}.pdf`;
      a.click();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to fetch download URL");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Reporting
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Report builder</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compose PDF reports from method parameters, chromatograms and peak tables.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={generate} disabled={busy || !method}>
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            {busy ? "Generating…" : "Generate PDF"}
          </Button>
          {!method && (
            <div className="text-[10px] text-muted-foreground">Select a method first.</div>
          )}
          {method && !methodRun && (
            <div className="text-[10px] text-[color:var(--status-warn)]">
              No run is linked to this method — chromatogram & peaks will be omitted.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Subject
          </div>
          <div className="mt-2 space-y-1">
            {methods.map((m) => (
              <button
                key={m.id}
                onClick={() => setMethodId(m.id)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs ${
                  methodId === m.id ? "bg-primary/15 text-primary" : "hover:bg-accent/30"
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
          <div className="mt-5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Sections
          </div>
          <div className="mt-2 space-y-1">
            {(
              [
                ["method", "Method parameters"],
                ["chromatogram", "Chromatogram (TIC)"],
                ["peaks", "Peak table"],
                ["eics", "Extracted ion chromatograms"],
                ["notes", "Notes"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={sections[key]}
                  onCheckedChange={(v) => setSections({ ...sections, [key]: !!v })}
                />
                {label}
              </label>
            ))}
          </div>

          {sections.eics && (
            <>
              <div className="mt-5 flex items-center justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
                <span>EIC analytes</span>
                <span className="font-mono normal-case tracking-normal text-muted-foreground">
                  {selectedEicIds.size}/{eicCandidates.length}
                </span>
              </div>
              {!hasScans && (
                <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground">
                  Selected run has no raw scans blob — EICs can't be extracted.
                </div>
              )}
              {hasScans && eicCandidates.length === 0 && (
                <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-[10px] text-muted-foreground">
                  No analytes with an m/z in the library yet.
                </div>
              )}
              {hasScans && eicCandidates.length > 0 && (
                <>
                  <div className="mt-1 flex gap-2 text-[10px]">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() =>
                        setSelectedEicIds(new Set(eicCandidates.map((a) => a.id)))
                      }
                    >
                      Select all
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setSelectedEicIds(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                  <ScrollArea className="mt-2 h-56 rounded-md border border-border">
                    <div className="space-y-1 p-2">
                      {eicCandidates.map((a) => (
                        <label
                          key={a.id}
                          className="flex cursor-pointer items-center gap-2 text-xs"
                        >
                          <Checkbox
                            checked={selectedEicIds.has(a.id)}
                            onCheckedChange={(v) =>
                              setSelectedEicIds((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(a.id);
                                else next.delete(a.id);
                                return next;
                              })
                            }
                          />
                          <span className="flex-1 truncate">{a.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {a.mz.toFixed(3)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
            </>
          )}
        </Card>

        <Card className="border-border bg-surface-elevated p-6">
          <div
            ref={printRef}
            className="mx-auto max-w-3xl space-y-6 rounded-md bg-card p-8 shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-primary">
                  CHROMA.LAB · Method Report
                </div>
                <h2 className="mt-1 text-lg font-semibold">{method?.name}</h2>
              </div>
              <FileText className="h-5 w-5 text-muted-foreground" />
            </div>

            {sections.method && method && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Method parameters
                </h3>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs">
                  <RField label="Modality" value={method.modality} />
                  <RField label="Ionization" value={method.msIonization} />
                  <RField label="Mobile phase A" value={method.mobilePhaseA} />
                  <RField label="Mobile phase B" value={method.mobilePhaseB} />
                  <RField label="Flow" value={`${method.flowRate} mL/min`} />
                  <RField label="Column temp" value={`${method.columnTemp} °C`} />
                </dl>
              </section>
            )}

            {sections.chromatogram && methodRun && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Representative chromatogram
                </h3>
                <div className="mt-2 rounded-md border border-border p-2">
                  <ChromatogramPlot runs={[methodRun]} height={200} showPeaks />
                </div>
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {methodRun.name}
                </div>
              </section>
            )}

            {sections.peaks && methodRun && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Peak table
                </h3>
                <div className="mt-2">
                  <PeakTable peaks={methodRun.peaks.slice(0, 8)} />
                </div>
              </section>
            )}

            {sections.eics && methodRun && selectedEicAnalytes.length > 0 && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Extracted ion chromatograms
                </h3>
                {!hasScans ? (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Run has no raw scans blob — EICs unavailable.
                  </div>
                ) : eicQuery.isLoading ? (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Extracting {selectedEicAnalytes.length} EIC trace(s)…
                  </div>
                ) : eicQuery.isError ? (
                  <div className="mt-2 text-[11px] text-destructive">
                    Failed to load EICs.
                  </div>
                ) : (
                  <EicReportBlock
                    analytes={selectedEicAnalytes}
                    data={eicQuery.data}
                  />
                )}
              </section>
            )}


            {sections.notes && method && (
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Notes
                </h3>
                <p className="mt-2 text-xs text-muted-foreground">{method.notes}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {method.tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              </section>
            )}

            <div className="border-t border-border pt-2 text-[9px] text-muted-foreground">
              Generated by CHROMA.LAB · {new Date().toLocaleDateString()}
            </div>
          </div>
        </Card>
      </div>

      <Card className="border-border bg-card p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Past reports
          </div>
          <h2 className="text-sm font-semibold">All generated PDFs</h2>
        </div>
        <div className="divide-y divide-border">
          {reportsQuery.isLoading && (
            <div className="px-4 py-3 text-xs text-muted-foreground">Loading…</div>
          )}
          {!reportsQuery.isLoading && (reportsQuery.data ?? []).length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No reports yet. Generate one above.
            </div>
          )}
          {(reportsQuery.data ?? []).map((r: any) => (
            <div
              key={r.id}
              className="flex items-center justify-between px-4 py-2 text-xs"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{r.title}</span>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {r.template}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <ShareDialog
                  resourceKind="report"
                  resourceId={r.id}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Share2 className="mr-1 h-3.5 w-3.5" /> Share
                    </Button>
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadReport(r.id, r.title)}
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
