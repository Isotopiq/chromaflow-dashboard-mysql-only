import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Upload,
  Copy,
  Trash2,
  Plus,
} from "lucide-react";
import {
  listAdminUsers,
  setUserRole,
  listAuditEvents,
  createUploadUrl,
} from "@/lib/lab.functions";
import {
  setBranding,
  createInviteCode,
  listInviteCodes,
  revokeInviteCode,
} from "@/lib/branding.functions";
import { useBranding } from "@/lib/use-branding";
import { toast } from "sonner";

export const Route = createFileRoute("/_shell/admin")({ component: Admin });

function Admin() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Admin</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage users, roles, invite codes, branding, and review the audit trail.
        </p>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList>
          <TabsTrigger value="users">Users & roles</TabsTrigger>
          <TabsTrigger value="invites">Invite codes</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>
        <TabsContent value="invites" className="mt-4">
          <InvitesTab />
        </TabsContent>
        <TabsContent value="branding" className="mt-4">
          <BrandingTab />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}


function UsersTab() {
  const list = useServerFn(listAdminUsers);
  const setRole = useServerFn(setUserRole);
  const qc = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list(),
  });

  const mut = useMutation({
    mutationFn: (vars: { userId: string; role: "admin" | "developer" | "reviewer" }) =>
      setRole({ data: vars }),
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <Shield className="h-4 w-4 text-primary" />
        <div className="text-xs">
          <div className="font-medium">Three roles supported</div>
          <p className="mt-0.5 text-muted-foreground">
            <span className="font-mono">admin</span> — full access including user management.{" "}
            <span className="font-mono">developer</span> — create/edit own methods, runs, columns.{" "}
            <span className="font-mono">reviewer</span> — read-all with annotation rights.
          </p>
        </div>
      </Card>

      {error && (
        <Card className="flex items-center gap-2 border-destructive/40 bg-destructive/5 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>Only admins can view this page. {(error as any)?.message ?? ""}</span>
        </Card>
      )}

      <Card className="border-border bg-card p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase tracking-wider">User</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Email</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-xs text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {(users ?? []).map((u) => (
              <TableRow key={u.id} className="text-xs">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[10px] font-semibold">
                      {u.avatar}
                    </div>
                    <span className="font-medium">{u.name}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select
                      defaultValue={u.role}
                      onValueChange={(v) =>
                        mut.mutate({
                          userId: u.id,
                          role: v as "admin" | "developer" | "reviewer",
                        })
                      }
                    >
                      <SelectTrigger className="h-8 w-36 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="developer">Developer</SelectItem>
                        <SelectItem value="reviewer">Reviewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {u.role}
                    </Badge>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

const TABLES = ["", "runs", "methods", "annotations"];
const ACTIONS = ["", "insert", "update", "delete"] as const;

function AuditTab() {
  const usersList = useServerFn(listAdminUsers);
  const list = useServerFn(listAuditEvents);

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => usersList(),
  });

  const [table, setTable] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [actorId, setActorId] = useState<string>("");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["audit", { table, action, actorId, since, until }],
    queryFn: () =>
      list({
        data: {
          table: table || undefined,
          action: (action || undefined) as any,
          actorId: actorId || undefined,
          since: since ? new Date(since).toISOString() : undefined,
          until: until ? new Date(until).toISOString() : undefined,
          limit: 200,
        },
      }),
  });

  const userById = new Map((users ?? []).map((u) => [u.id, u]));

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Card className="flex items-center gap-2 border-destructive/40 bg-destructive/5 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>{(error as any)?.message ?? "Failed to load audit events"}</span>
        </Card>
      )}

      <Card className="flex flex-wrap items-end gap-3 border-border bg-card p-4">
        <Field label="Table">
          <Select value={table} onValueChange={(v) => setTable(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All tables" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All tables</SelectItem>
              {TABLES.filter(Boolean).map((t) => (
                <SelectItem key={t} value={t} className="text-xs font-mono">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Action">
          <Select value={action} onValueChange={(v) => setAction(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All</SelectItem>
              {ACTIONS.filter(Boolean).map((a) => (
                <SelectItem key={a} value={a} className="text-xs">
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Actor">
          <Select value={actorId} onValueChange={(v) => setActorId(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="All users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All users</SelectItem>
              {(users ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name} <span className="text-muted-foreground">{u.email}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="From">
          <Input
            type="datetime-local"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="h-8 w-48 text-xs"
          />
        </Field>
        <Field label="To">
          <Input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            className="h-8 w-48 text-xs"
          />
        </Field>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </Card>

      <Card className="border-border bg-card p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase tracking-wider">When</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Actor</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Table</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Action</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Row</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Diff</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                  No events found.
                </TableCell>
              </TableRow>
            )}
            {(data ?? []).map((e: any) => (
              <AuditRow
                key={e.id}
                row={e}
                actorEmail={
                  e.actor_id
                    ? userById.get(e.actor_id)?.email ??
                      `${String(e.actor_id).slice(0, 8)}…`
                    : "system"
                }
              />
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function AuditRow({ row, actorEmail }: { row: any; actorEmail: string }) {
  const [open, setOpen] = useState(false);
  const actionColor =
    row.action === "delete"
      ? "text-destructive"
      : row.action === "insert"
        ? "text-[color:var(--peak-annotated)]"
        : "text-primary";
  return (
    <TableRow className="text-xs align-top">
      <TableCell className="font-mono text-[10px] text-muted-foreground">
        {new Date(row.created_at).toLocaleString()}
      </TableCell>
      <TableCell className="font-mono text-[10px]">{actorEmail}</TableCell>
      <TableCell className="font-mono">{row.table_name}</TableCell>
      <TableCell className={`font-mono uppercase ${actionColor}`}>{row.action}</TableCell>
      <TableCell className="font-mono text-[10px] text-muted-foreground">
        {row.row_id ? `${String(row.row_id).slice(0, 8)}…` : "—"}
      </TableCell>
      <TableCell>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {open ? "Hide" : "Show"}
        </button>
        {open && (
          <pre className="mt-1 max-h-60 max-w-xl overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[10px]">
            {JSON.stringify(row.diff, null, 2)}
          </pre>
        )}
      </TableCell>
    </TableRow>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// ============================================================
// Invite codes
// ============================================================
function InvitesTab() {
  const listFn = useServerFn(listInviteCodes);
  const createFn = useServerFn(createInviteCode);
  const revokeFn = useServerFn(revokeInviteCode);
  const qc = useQueryClient();
  const [role, setRole] = useState<"admin" | "developer" | "reviewer">("developer");
  const [expiresInDays, setExpiresInDays] = useState<string>("30");
  const [note, setNote] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["invite-codes"],
    queryFn: () => listFn(),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          role,
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
          note: note || undefined,
        },
      }),
    onSuccess: (row: any) => {
      navigator.clipboard?.writeText(row.code).catch(() => {});
      toast.success(`Code generated and copied: ${row.code}`);
      setNote("");
      qc.invalidateQueries({ queryKey: ["invite-codes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Code revoked");
      qc.invalidateQueries({ queryKey: ["invite-codes"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Card className="flex items-center gap-2 border-destructive/40 bg-destructive/5 p-3 text-xs">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span>{(error as any)?.message ?? "Failed to load codes"}</span>
        </Card>
      )}

      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Generate invite code
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Role">
            <Select value={role} onValueChange={(v) => setRole(v as any)}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="developer">Developer</SelectItem>
                <SelectItem value="reviewer">Reviewer</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Expires in (days)">
            <Input
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="h-8 w-32 text-xs"
            />
          </Field>
          <Field label="Note (optional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For Jane Doe"
              className="h-8 w-56 text-xs"
            />
          </Field>
          <Button
            size="sm"
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {createMut.isPending ? "Generating…" : "Generate code"}
          </Button>
        </div>
      </Card>

      <Card className="border-border bg-card p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase tracking-wider">Code</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Role</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Expires</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Note</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                  No invite codes yet.
                </TableCell>
              </TableRow>
            )}
            {(data ?? []).map((c: any) => {
              const status = c.used_at
                ? "used"
                : c.revoked_at
                  ? "revoked"
                  : c.expires_at && new Date(c.expires_at).getTime() < Date.now()
                    ? "expired"
                    : "active";
              return (
                <TableRow key={c.id} className="text-xs">
                  <TableCell className="font-mono">{c.code}</TableCell>
                  <TableCell className="capitalize">{c.role}</TableCell>
                  <TableCell>
                    <Badge
                      variant={status === "active" ? "default" : "outline"}
                      className="capitalize"
                    >
                      {status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.note ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard?.writeText(c.code);
                        toast.success("Copied");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    {status === "active" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeMut.mutate(c.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ============================================================
// Branding
// ============================================================
function BrandingTab() {
  const uploadFn = useServerFn(createUploadUrl);
  const setBrandingFn = useServerFn(setBranding);
  const { data: branding, refetch } = useBranding();
  const qc = useQueryClient();
  const [appName, setAppName] = useState("");
  const [savingName, setSavingName] = useState(false);

  type PathField =
    | "faviconPath"
    | "webLogoPath"
    | "pdfLogoPath"
    | "webLogoLightPath"
    | "webLogoDarkPath";
  type UrlField =
    | "faviconUrl"
    | "webLogoUrl"
    | "pdfLogoUrl"
    | "webLogoLightUrl"
    | "webLogoDarkUrl";

  const upload = async (file: File, field: PathField, label: string) => {
    try {
      const up = await uploadFn({
        data: { filename: file.name, bucket: "branding" },
      });
      const put = await fetch(up.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await setBrandingFn({ data: { [field]: up.path } as any });
      toast.success(`${label} updated`);
      qc.invalidateQueries({ queryKey: ["branding"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    }
  };

  const clearAsset = async (field: PathField, label: string) => {
    try {
      await setBrandingFn({ data: { [field]: null } as any });
      toast.success(`${label} removed`);
      qc.invalidateQueries({ queryKey: ["branding"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  const saveUrl = async (field: UrlField, value: string, label: string) => {
    try {
      await setBrandingFn({ data: { [field]: value.trim() || null } as any });
      toast.success(`${label} URL ${value.trim() ? "updated" : "cleared"}`);
      qc.invalidateQueries({ queryKey: ["branding"] });
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };



  const saveAppName = async () => {
    setSavingName(true);
    try {
      await setBrandingFn({ data: { appName: appName.trim() || null } });
      toast.success("App name updated");
      qc.invalidateQueries({ queryKey: ["branding"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          App name
        </div>
        <div className="mt-2 flex items-end gap-2">
          <Input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder={branding?.appName ?? "CHROMA.LAB"}
            className="h-8 max-w-xs text-xs"
          />
          <Button size="sm" onClick={saveAppName} disabled={savingName}>
            Save
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <BrandingAsset
          label="Favicon"
          hint="PNG/SVG, ~32×32. Shown in browser tabs."
          url={branding?.faviconUrl ?? null}
          urlExplicit={branding?.faviconUrlExplicit ?? null}
          accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
          onUpload={(f) => upload(f, "faviconPath", "Favicon")}
          onClear={() => clearAsset("faviconPath", "Favicon")}
          onSaveUrl={(v) => saveUrl("faviconUrl", v, "Favicon")}
        />
        <BrandingAsset
          label="Web logo (fallback)"
          hint="Used when no theme-specific logo is set."
          url={branding?.webLogoUrl ?? null}
          urlExplicit={branding?.webLogoUrlExplicit ?? null}
          accept="image/*"
          onUpload={(f) => upload(f, "webLogoPath", "Web logo")}
          onClear={() => clearAsset("webLogoPath", "Web logo")}
          onSaveUrl={(v) => saveUrl("webLogoUrl", v, "Web logo")}
        />
        <BrandingAsset
          label="PDF logo"
          hint="Printed in the top right of generated PDF reports."
          url={branding?.pdfLogoUrl ?? null}
          urlExplicit={branding?.pdfLogoUrlExplicit ?? null}
          accept="image/png,image/jpeg,image/svg+xml"
          onUpload={(f) => upload(f, "pdfLogoPath", "PDF logo")}
          onClear={() => clearAsset("pdfLogoPath", "PDF logo")}
          onSaveUrl={(v) => saveUrl("pdfLogoUrl", v, "PDF logo")}
        />
      </div>

      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Theme-specific web logos
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <BrandingAsset
          label="Web logo — light theme"
          hint="Shown in the sidebar and login when the app is in light mode."
          url={branding?.webLogoLightUrl ?? null}
          urlExplicit={branding?.webLogoLightUrlExplicit ?? null}
          accept="image/*"
          previewBg="light"
          onUpload={(f) => upload(f, "webLogoLightPath", "Light logo")}
          onClear={() => clearAsset("webLogoLightPath", "Light logo")}
          onSaveUrl={(v) => saveUrl("webLogoLightUrl", v, "Light logo")}
        />
        <BrandingAsset
          label="Web logo — dark theme"
          hint="Shown in the sidebar and login when the app is in dark mode."
          url={branding?.webLogoDarkUrl ?? null}
          urlExplicit={branding?.webLogoDarkUrlExplicit ?? null}
          accept="image/*"
          previewBg="dark"
          onUpload={(f) => upload(f, "webLogoDarkPath", "Dark logo")}
          onClear={() => clearAsset("webLogoDarkPath", "Dark logo")}
          onSaveUrl={(v) => saveUrl("webLogoDarkUrl", v, "Dark logo")}
        />
      </div>


      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-3 text-xs">
        <Shield className="h-4 w-4 text-primary" />
        <div>
          <div className="font-medium">Tip</div>
          <p className="mt-0.5 text-muted-foreground">
            You can either upload a file or paste a direct image URL. When both
            are set, the URL takes precedence. Leave the URL field empty and
            click Save to fall back to the uploaded file.
          </p>
        </div>
      </Card>

    </div>
  );
}

function BrandingAsset({
  label,
  hint,
  url,
  urlExplicit,
  accept,
  onUpload,
  onClear,
  onSaveUrl,
}: {
  label: string;
  hint: string;
  url: string | null;
  urlExplicit: string | null;
  accept: string;
  onUpload: (f: File) => void;
  onClear: () => void;
  onSaveUrl: (v: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [urlDraft, setUrlDraft] = useState(urlExplicit ?? "");
  // Sync local draft when the server value changes (e.g. after save).
  const lastExplicit = useRef<string | null>(urlExplicit);
  if (lastExplicit.current !== urlExplicit) {
    lastExplicit.current = urlExplicit;
    if ((urlExplicit ?? "") !== urlDraft) setUrlDraft(urlExplicit ?? "");
  }
  return (
    <Card className="border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
      <div className="mt-3 flex h-24 items-center justify-center rounded-md border border-dashed border-border bg-muted/20">
        {url ? (
          <img
            src={url}
            alt={label}
            className="max-h-20 max-w-[80%] object-contain"
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">No image</span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mr-1 h-3.5 w-3.5" /> Upload
        </Button>
        {url && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Or use image URL
        </div>
        <div className="mt-1 flex gap-2">
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSaveUrl(urlDraft)}
          >
            Save
          </Button>
        </div>
        {urlExplicit && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            URL overrides the uploaded file.
          </p>
        )}
      </div>
    </Card>
  );
}


