import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FlaskConical,
  Columns3,
  FileBarChart,
  Layers,
  Beaker,
  PackageOpen,
  FileText,
  Shield,
  Activity,
  UserCog,
} from "lucide-react";
import logoAsset from "@/assets/Isotopiq-Logo.png.asset.json";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useLab } from "@/lib/store";
import { useBranding } from "@/lib/use-branding";
import { useTheme } from "@/components/theme-provider";


const groups: Array<{
  label: string;
  items: Array<{ title: string; url: string; icon: React.ComponentType<{ className?: string }> }>;
}> = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    label: "Methods",
    items: [
      { title: "Method log", url: "/methods", icon: FlaskConical },
      { title: "Compare methods", url: "/methods/compare", icon: Layers },
    ],
  },
  {
    label: "Acquisition",
    items: [
      { title: "Runs & uploads", url: "/runs", icon: Activity },
      { title: "Overlay workspace", url: "/overlay", icon: FileBarChart },
      { title: "Analyte comparison", url: "/analytes", icon: Beaker },
    ],
  },
  {
    label: "Inventory",
    items: [
      { title: "Column library", url: "/columns", icon: Columns3 },
      { title: "Batches", url: "/batches", icon: PackageOpen },
    ],
  },
  {
    label: "Reporting",
    items: [{ title: "Reports", url: "/reports", icon: FileText }],
  },
  {
    label: "Settings",
    items: [{ title: "Account", url: "/account", icon: UserCog }],
  },
  {
    label: "Admin",
    items: [{ title: "Users & roles", url: "/admin", icon: Shield }],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const currentUser = useLab((s) => s.currentUser);
  const isAdmin = currentUser?.role === "admin";
  const { data: branding } = useBranding();
  const { theme } = useTheme();
  const themedLogo =
    theme === "light" ? branding?.webLogoLightUrl : branding?.webLogoDarkUrl;
  const logoSrc = themedLogo || branding?.webLogoUrl || logoAsset.url;
  const appName = branding?.appName?.trim() || "CHROMA.LAB";

  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(url + "/");

  const visibleGroups = groups.filter((g) => g.label !== "Admin" || isAdmin);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <Link to="/" className="flex items-center gap-2">
          <img
            src={branding?.webLogoUrl || logoAsset.url}
            alt={appName}
            className="h-8 w-auto shrink-0 object-contain"
          />
          {!collapsed && (
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Method Dev Platform
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {visibleGroups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest">
              {g.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && currentUser && (
          <Link
            to="/account"
            className="flex items-center gap-2 rounded-md p-1 text-xs hover:bg-sidebar-accent"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-[10px] font-semibold">
              {currentUser.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                currentUser.avatar
              )}
            </div>
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-medium">{currentUser.name}</span>
              <span className="text-[10px] capitalize text-muted-foreground">
                {currentUser.role}
              </span>
            </div>
          </Link>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
