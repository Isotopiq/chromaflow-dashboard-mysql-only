import { Search, Upload, Bell, Sun, Moon, LogOut } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/lib/auth-context";
import { useLab } from "@/lib/store";
import { toast } from "sonner";

export function Topbar({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { theme, toggle } = useTheme();
  const { signOut, user } = useAuth();
  const currentUser = useLab((s) => s.currentUser);

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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggle}
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Bell className="h-4 w-4" />
          </Button>
          {user && (
            <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
              <div className="hidden flex-col items-end leading-tight sm:flex">
                <span className="text-xs font-medium">{currentUser?.name ?? user.email}</span>
                <Badge variant="outline" className="text-[9px] capitalize">
                  {currentUser?.role ?? "developer"}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                title="Sign out"
                onClick={async () => {
                  await signOut();
                  toast.success("Signed out");
                }}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
