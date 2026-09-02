import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Copy, Plus, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { upsertMethodTemplate, deleteMethodTemplate } from "@/lib/v3-functions";
import type { MethodTemplate } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  const { methodTemplates, methods } = useLab();
  const upsertLocal = useLab((s) => s.upsertMethodTemplateLocal);
  const removeLocal = useLab((s) => s.removeMethodTemplateLocal);
  const upsertFn = useServerFn(upsertMethodTemplate);
  const deleteFn = useServerFn(deleteMethodTemplate);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceMethodId, setSourceMethodId] = useState("");
  const [saving, setSaving] = useState(false);

  async function createTemplate() {
    if (!name.trim()) { toast.error("Name required."); return; }
    setSaving(true);
    try {
      const sourceMethod = methods.find((m) => m.id === sourceMethodId);
      const templateJson = sourceMethod ? {
        modality: sourceMethod.modality,
        gradient: sourceMethod.gradient,
        msScans: sourceMethod.msScans,
        msIonization: sourceMethod.msIonization,
        msScanRange: sourceMethod.msScanRange,
        flowRate: sourceMethod.flowRate,
        columnTemp: sourceMethod.columnTemp,
        injectionVolume: sourceMethod.injectionVolume,
        detector: sourceMethod.detector,
        mobilePhaseA: sourceMethod.mobilePhaseA,
        mobilePhaseB: sourceMethod.mobilePhaseB,
      } : {};
      const t = await upsertFn({
        data: { name: name.trim(), description: description.trim(), templateJson },
      });
      upsertLocal(t);
      toast.success("Template created");
      setShowForm(false);
      setName(""); setDescription(""); setSourceMethodId("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create template");
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(id: string) {
    try {
      await deleteFn({ data: { id } });
      removeLocal(id);
      toast.success("Template deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Workflow
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Method templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Save and reuse method configurations. Create a template from an existing method.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-1 h-4 w-4" /> New template
        </Button>
      </div>

      {showForm && (
        <Card className="border-border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. zHILIC Standard Gradient"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-method">Source method (optional)</Label>
              <select
                id="tpl-method"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={sourceMethodId}
                onChange={(e) => setSourceMethodId(e.target.value)}
              >
                <option value="">None (blank template)</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                id="tpl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What is this template for?"
              />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button onClick={createTemplate} disabled={saving}>
                {saving ? "Saving…" : "Create template"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="border-border bg-card p-4">
        {methodTemplates.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No templates yet. Create one to reuse method configurations.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Created</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {methodTemplates.map((t: MethodTemplate) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.description}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeTemplate(t.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
