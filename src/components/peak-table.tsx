import type { Peak } from "@/lib/lab-types";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function PeakTable({
  peaks,
  selectedId,
  onSelect,
}: {
  peaks: Peak[];
  selectedId?: string;
  onSelect?: (p: Peak) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="h-8 text-[10px] uppercase tracking-wider">RT</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider">Area</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider">Height</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider">FWHM</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider">S/N</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider">m/z</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider">Annotation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {peaks.map((p) => (
            <TableRow
              key={p.id}
              onClick={() => onSelect?.(p)}
              className={cn(
                "cursor-pointer font-mono text-xs",
                selectedId === p.id && "bg-accent/40",
              )}
            >
              <TableCell className="py-1.5">{p.rt.toFixed(2)}</TableCell>
              <TableCell className="py-1.5">{p.area.toLocaleString()}</TableCell>
              <TableCell className="py-1.5">{p.height.toLocaleString()}</TableCell>
              <TableCell className="py-1.5">{p.fwhm.toFixed(3)}</TableCell>
              <TableCell className="py-1.5">{p.sn.toFixed(1)}</TableCell>
              <TableCell className="py-1.5">{p.mz?.toFixed(4) ?? "—"}</TableCell>
              <TableCell className="py-1.5 font-sans">
                {p.analyteName ? (
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="border-[color:var(--peak-annotated)] text-[10px] text-[color:var(--peak-annotated)]"
                    >
                      {p.analyteName}
                    </Badge>
                    {p.confidence !== undefined && (
                      <span className="text-[10px] text-muted-foreground">
                        {(p.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">unannotated</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
