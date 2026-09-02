import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FolderSync, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { upsertWatchFolder, deleteWatchFolder } from "@/lib/v3-functions";

export const Route = createFileRoute("/_shell/auto-import")({
  component: AutoImportPage,
});

function AutoImportPage() {
  const { importWatchFolders, methods, columns, batches } = useLab();
  const upsertLocal = useLab((s) => s.upsertImportWatchFolderLocal);
  const removeLocal = useLab((s) => s.removeImportWatchFolderLocal);
  const upsertFn = useServerFn(upsertWatchFolder);
  const deleteFn = useServerFn(deleteWatchFolder);

  const [path, setPath] = useState("");
  const [methodId, setMethodId] = useState("");
  const [columnId, setColumnId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [filePattern, setFilePattern] = useState("*.mzXML");
  const [saving, setSaving] = useState(false);

  async function addFolder() {
    if (!path.trim()) { toast.error("Path required."); return; }
    setSaving(true);
    try {
      const f = await upsertFn({
        data: {
          path: path.trim(),
          methodId: methodId || null,
          columnId: columnId || null,
          batchId: batchId || null,
          filePattern: filePattern.trim(),
        },
      });
      upsertLocal(f);
      toast.success("Watch folder added. Server will start watching on next restart.");
      setPath(""); setMethodId(""); setColumnId(""); setBatchId("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add folder");
    } finally {
      setSaving(false);
    }
  }

  async function removeFolder(id: string) {
    try {
      await deleteFn({ data: { id } });
      removeLocal(id);
      toast.success("Watch folder removed");
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Settings
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Auto-import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure folder watchers to automatically import mzXML/mzML files as they arrive from the instrument.
          Mount the instrument data folder as a Docker volume to enable real-time import.
        </p>
      </div>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">Add watch folder</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="folder-path">Folder path (mounted volume)</Label>
            <Input
              id="folder-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/data/instrument-output"
            />
          </div>
          <div className="space-y-1">
            <Label>Default method</Label>
            <Select value={methodId || "none"} onValueChange={(v) => setMethodId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {methods.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Default column</Label>
            <Select value={columnId || "none"} onValueChange={(v) => setColumnId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Default batch</Label>
            <Select value={batchId || "none"} onValueChange={(v) => setBatchId(v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="file-pattern">File pattern</Label>
            <Input
              id="file-pattern"
              value={filePattern}
              onChange={(e) => setFilePattern(e.target.value)}
              placeholder="*.mzXML"
            />
          </div>
          <div className="md:col-span-2">
            <Button onClick={addFolder} disabled={saving}>
              {saving ? "Adding…" : "Add watch folder"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <FolderSync className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">Active watch folders</div>
        </div>
        {importWatchFolders.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No watch folders configured.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="w-20">Enabled</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importWatchFolders.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.path}</TableCell>
                  <TableCell className="text-xs">{f.filePattern}</TableCell>
                  <TableCell className="text-xs">
                    {methods.find((m) => m.id === f.methodId)?.name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <span className={`text-[10px] font-medium ${f.enabled ? "text-green-600" : "text-muted-foreground"}`}>
                      {f.enabled ? "Active" : "Disabled"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeFolder(f.id)}
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
