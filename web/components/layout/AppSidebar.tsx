"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  KanbanSquare,
  Archive,
  Megaphone,
  Settings,
  Users,
  BookOpen,
  Sparkles,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

// Curator, Publisher, and Artist used to each be their own standalone page
// with no sidebar at all — reachable, but every click into one visually
// "ate" the sidebar and dropped you into a differently-shaped page, and
// clicking back out meant hunting for a "Back to Admin" link two of them
// grew as a stopgap. Reported directly: some pages losing the sidebar felt
// forced. Real fix, not another patch: all four now live under the same
// app/(shell) route group and share this one sidebar (renamed from
// AdminSidebar now that it's genuinely not admin-only), so the shell
// itself never disappears — only its own collapse state changes, and that
// state is the user's choice, not something a route switches on them.
const NAV_ITEMS = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/board", icon: KanbanSquare, label: "Board" },
  { href: "/curator", icon: Sparkles, label: "Curation" },
  { href: "/admin/knowledge", icon: BookOpen, label: "Knowledge" },
  { href: "/admin/archive", icon: Archive, label: "Archive" },
  { href: "/admin/personnel", icon: Users, label: "Personnel" },
  { href: "/admin/marketing", icon: Megaphone, label: "Marketing" },
  { href: "/publisher", icon: PackageCheck, label: "Uploader Queue" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

const COLLAPSE_KEY = "pipeline_sidebar_collapsed";

// Presentation matches Catalog Intel's own sidebar (App.tsx): a branded
// header block, labeled nav rows (not an icon-only rail by default), and
// the same active-state convention — a left accent border plus a tinted
// background, not a flat solid fill — so this reads as the same product.
export function AppSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Read the saved preference after mount, same reasoning as any
  // localStorage-backed state in this app (PublicForm.tsx has the fuller
  // version of this comment): localStorage doesn't exist during SSR, so
  // there's no render-time value to compute this from, and hydrating it
  // via a lazy useState initializer would run once on the server (where
  // window is undefined) and again on the client, producing a mismatch.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Unavailable localStorage just means it starts expanded every time.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }

  return (
    <nav
      className={`flex flex-col h-screen shrink-0 bg-sidebar border-r border-sidebar-border transition-[width] duration-150 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className="h-14 shrink-0 flex items-center px-3 border-b border-sidebar-border justify-between">
        <div className="flex items-center min-w-0">
          <div className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold text-sm flex-shrink-0 bg-primary">
            M
          </div>
          {!collapsed && (
            <div className="ml-2.5 min-w-0">
              <span className="block font-display font-semibold tracking-tight text-white text-sm leading-none truncate">
                MetaFashion
              </span>
              <span className="block text-[9px] text-sidebar-foreground tracking-widest mt-0.5">PIPELINE</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`w-full flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded text-sm transition-colors ${
                isActive ? "text-white" : "text-sidebar-foreground hover:text-white hover:bg-sidebar-accent"
              }`}
              style={
                isActive
                  ? { backgroundColor: "var(--sidebar-accent)", borderLeft: "3px solid var(--sidebar-primary)", paddingLeft: "9px" }
                  : { borderLeft: "3px solid transparent" }
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </div>

      {/* A real toggle, not a route-dependent accident — the same control
          on every page, so hiding/showing the sidebar is always the user's
          own action instead of something clicking into a different tool
          does to them. */}
      <div className="shrink-0 border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="w-full flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded text-sm text-sidebar-foreground hover:text-white hover:bg-sidebar-accent transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4 flex-shrink-0" /> : <PanelLeftClose className="w-4 h-4 flex-shrink-0" />}
          {!collapsed && <span className="truncate">Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
