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
