import { createFileRoute } from "@tanstack/react-router";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Shield } from "lucide-react";

export const Route = createFileRoute("/_shell/admin")({
  component: Admin,
});

function Admin() {
  const { users } = useLab();

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Admin</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Users & roles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Role assignments. In phase 2, these are backed by a `user_roles` table with row-level
          security.
        </p>
      </div>

      <Card className="flex items-start gap-3 border-primary/30 bg-primary/5 p-4">
        <Shield className="h-4 w-4 text-primary" />
        <div className="text-xs">
          <div className="font-medium">Three roles supported</div>
          <p className="mt-0.5 text-muted-foreground">
            <span className="font-mono">admin</span> — full access including user management.{" "}
            <span className="font-mono">developer</span> — create/edit methods, runs, columns.{" "}
            <span className="font-mono">reviewer</span> — read-only with annotation rights.
          </p>
        </div>
      </Card>

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
            {users.map((u) => (
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
                  <Select defaultValue={u.role}>
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="developer">Developer</SelectItem>
                      <SelectItem value="reviewer">Reviewer</SelectItem>
                    </SelectContent>
                  </Select>
                  <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                    {u.role}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
