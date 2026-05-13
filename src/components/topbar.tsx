import { Search, Upload, Bell } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Topbar({ title, subtitle }: { title?: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {title && (
          <div className="flex min-w-0 flex-col leading-tight">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            {subtitle && (
              <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden md:block">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search methods, runs, analytes…"
              className="h-8 w-72 pl-7 text-xs"
            />
          </div>
          <Button asChild size="sm" variant="default" className="h-8 gap-1.5">
            <Link to="/runs">
              <Upload className="h-3.5 w-3.5" />
              Upload
            </Link>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Bell className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
