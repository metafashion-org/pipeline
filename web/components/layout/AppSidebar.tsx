"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  LayoutDashboard,
  KanbanSquare,
  CalendarDays,
  Megaphone,
  Settings,
  ClipboardList,
  Users,
  BookOpen,
  BadgeCheck,
  PackageCheck,
  Wallet,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Menu,
  X,
  Eye,
  ListTodo,
  UploadCloud,
  IdCard,
  Landmark,
  ListChecks,
  Info,
} from "lucide-react";
import { isRouteAllowedForRoles, getEffectiveCapabilities, ALL_ROLES, type SystemRole } from "@/lib/auth/rbac";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format-date";
import { whatsNewFor, type WhatsNewEntry } from "./whats-new";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetcher";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Every internal page shares this one sidebar. Before, admin/* had a sidebar and artist,
// curator and publisher each stood alone, so moving between tools looked like the shell kept
// disappearing.
// An artist's own pages. My Tasks only renders for someone whose collapsed role is artist (see
// app/(shell)/artist/page.tsx), so it is shown only to artists who don't also run production.
// My details is for anyone who is paid as an artist, including admins who also hold the role.
function hasArtistRole(roles: string[]): boolean {
  return roles.some((r) => r.toLowerCase() === "artist");
}

function isArtistOnly(roles: string[]): boolean {
  const normalized = roles.map((r) => r.toLowerCase());
  return normalized.includes("artist") && !normalized.includes("admin") && !normalized.includes("operator");
}

const NAV_ITEMS: { href: string; icon: typeof LayoutDashboard; label: string; onlyFor?: (roles: string[]) => boolean }[] = [
  { href: "/artist", icon: ListTodo, label: "My Tasks", onlyFor: isArtistOnly },
  { href: "/artist/submit", icon: UploadCloud, label: "Submit final files" },
  { href: "/artist/profile", icon: IdCard, label: "My details", onlyFor: hasArtistRole },
  { href: "/team", icon: ListChecks, label: "Team Tasks" },
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/board", icon: KanbanSquare, label: "Board" },
  { href: "/admin/calendar", icon: CalendarDays, label: "Calendar" },
  { href: "/admin/signoff", icon: BadgeCheck, label: "Sign-off" },
  { href: "/admin/knowledge", icon: BookOpen, label: "Registry" },
  { href: "/admin/archive", icon: Wallet, label: "Payments" },
  { href: "/admin/artist-details", icon: Landmark, label: "Artist details" },
  { href: "/admin/personnel", icon: Users, label: "Personnel" },
  { href: "/admin/marketing", icon: Megaphone, label: "Marketing" },
  { href: "/publisher", icon: PackageCheck, label: "Uploader Queue" },
  { href: "/admin/forms", icon: ClipboardList, label: "Forms" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

const COLLAPSE_KEY = "pipeline_sidebar_collapsed";
const UPLOADER_QUEUE_HREF = "/publisher";
const UPLOAD_COUNT_URL = "/api/publisher/count";
const UPLOAD_COUNT_REFRESH_MS = 60_000;

const ROLE_LABELS: Record<SystemRole, string> = {
  admin: "Admin",
  operator: "Operator",
  curator: "Curator",
  artist: "Artist",
  publisher: "Publisher",
  marketing: "Marketing",
  payment_admin: "Payment Admin",
  full_time: "Full-time team",
};

export interface SidebarViewer {
  email: string | null;
  roles: string[];
  capabilityOverrides: Record<string, boolean>;
}

// A new page's "New ⓘ" mark. Clicking it says why the page was added and what it's for. A sibling
// of the link, not inside it, so opening it doesn't navigate.
function WhatsNewMark({ label, entry }: { label: string; entry: WhatsNewEntry }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`New: why we added ${label}`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400 hover:bg-emerald-500/25"
        >
          New
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 space-y-2 text-sm">
        <p className="font-medium">New: {label}</p>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Why we added it</p>
          <p>{entry.why}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">What it&apos;s for</p>
          <p>{entry.whatFor}</p>
        </div>
        <p className="text-xs text-muted-foreground">Marked new until {formatDate(entry.newUntil)}.</p>
      </PopoverContent>
    </Popover>
  );
}

// Split out of AppSidebar so the picker's own JSX branching doesn't add to that function's
// control-flow complexity. State stays lifted in the parent (it needs previewRole too, to filter
// NAV_ITEMS), so this is a plain controlled component, not a second source of truth.
function PreviewRolePicker({
  collapsed,
  previewRole,
  onChange,
}: {
  collapsed: boolean;
  previewRole: SystemRole | null;
  onChange: (role: SystemRole | null) => void;
}) {
  if (collapsed) return null;

  return (
    <div className="shrink-0 px-2 pt-2">
      <div className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/70">
        <Eye className="w-3 h-3" />
        Preview nav as
      </div>
      <Select
        value={previewRole ?? "__real__"}
        onValueChange={(v) => onChange(v === "__real__" ? null : (v as SystemRole))}
      >
        <SelectTrigger className="h-8 text-xs w-full" aria-label="Preview navigation as role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__real__">My real access</SelectItem>
          {ALL_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {previewRole && (
        // Deliberately not "you're viewing as X" — this changes which links show, not what
        // renders when you click them. Pages still load with the real signed-in user's real
        // permissions and real data, so overstating this as a login-swap would be misleading.
        <p className="px-1 pt-1 text-[10px] leading-snug text-amber-400">
          Menu only — pages still show your own real data.
        </p>
      )}
    </div>
  );
}

// The viewer is passed down from the server layout, which already has the session, rather than
// read here with useSession. That avoids mounting a SessionProvider and refetching on the client
// something the server rendered this page with, and it means the nav is correct in the first
// paint instead of filtering itself once the session arrives.
export function AppSidebar({ viewer, today }: { viewer: SidebarViewer; today: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Separate from `collapsed`: on a phone the sidebar is a panel that slides over the page and
  // closes on navigation, not a rail that sits beside it.
  //
  // Held as the path the panel was opened on rather than a boolean, so navigating closes it as a
  // consequence of the path changing instead of needing an effect to watch for that and call
  // setState — which is a cascading render, and what the effect version was doing.
  const [openedOnPath, setOpenedOnPath] = useState<string | null>(null);
  const mobileOpen = openedOnPath !== null && openedOnPath === pathname;

  // Read the saved preference after mount. localStorage does not exist during the server render,
  // so there is no render-time value to compute this from, and a lazy useState initializer would
  // run on the server too and produce a hydration mismatch.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Unavailable localStorage just means it starts expanded every time.
    }
  }, []);

  // The write used to live inside the setCollapsed updater. React may call an updater more than
  // once, so the write ran more often than the toggle did.
  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      // best-effort persistence only
    }
  }

  const roles = viewer.roles;
  const overrides = viewer.capabilityOverrides;

  // "Preview nav as <role>" — admin-only, nav-only. It swaps which role's capabilities decide
  // which links render, so an admin can sanity-check what e.g. an artist's menu looks like
  // without needing a second account. It does NOT change what data loads: every page still
  // renders for the real signed-in user with their real permissions, so this is a sighted-check
  // on the menu, not a real impersonation — see lib/auth/rbac.ts's ALL_ROLES doc comment.
  // Session state only (not persisted), so nobody is left "stuck" previewing after a reload.
  const [previewRole, setPreviewRole] = useState<SystemRole | null>(null);
  const canPreview = getEffectiveCapabilities(roles, overrides).canManageSystemConfig;
  const navRoles = canPreview && previewRole ? [previewRole] : roles;
  const navOverrides = canPreview && previewRole ? {} : overrides;

  // Only the destinations this person can actually open. Every user was shown all ten, so a
  // curator clicking Personnel, Settings or Forms landed on /unauthorized — the nav advertised
  // work they had no way to do. Same rule proxy.ts enforces, so the list and the gate agree.
  // A count on the Uploader Queue of assets waiting for their Roblox links, so the uploader sees
  // there's work without opening the page. Only for people who upload (the route checks too).
  const canUpload = getEffectiveCapabilities(roles, overrides).canPublishToRoblox;
  const { data: uploadCount } = useSWR<{ count: number }>(canUpload ? UPLOAD_COUNT_URL : null, jsonFetcher, { refreshInterval: UPLOAD_COUNT_REFRESH_MS });
  const badgeFor = (href: string) => (href === UPLOADER_QUEUE_HREF && uploadCount?.count ? uploadCount.count : 0);

  const visibleItems = NAV_ITEMS.filter(
    (item) => isRouteAllowedForRoles(item.href, navRoles, navOverrides) && (!item.onlyFor || item.onlyFor(navRoles))
  );

  const panel = (
    <>
      <div className="h-14 shrink-0 flex items-center px-3 border-b border-sidebar-border">
        <div className="flex items-center min-w-0">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold shrink-0 bg-primary">
            M
          </div>
          {!collapsed && (
            <div className="ml-2.5 min-w-0">
              <span className="block font-display font-semibold tracking-tight text-white text-base leading-tight truncate">
                Meta Fashion
              </span>
              <span className="block text-xs text-sidebar-foreground leading-tight">Pipeline</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpenedOnPath(null)}
          aria-label="Close menu"
          className="md:hidden ml-auto h-9 w-9 grid place-items-center rounded-md text-sidebar-foreground hover:text-white hover:bg-sidebar-accent"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {canPreview && (
        <PreviewRolePicker collapsed={collapsed} previewRole={previewRole} onChange={setPreviewRole} />
      )}

      <div className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map(({ href, icon: Icon, label }) => {
            // "/admin" and "/artist" are also the start of their section's other pages, so they match exactly.
            const isActive = href === "/admin" || href === "/artist" ? pathname === href : pathname.startsWith(href);
            const whatsNew = whatsNewFor(href, today);
            const badge = badgeFor(href);
            return (
              <div key={href} className="relative">
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  aria-current={isActive ? "page" : undefined}
                  // min-h-10 rather than py-2: 40px is a target you can hit without aiming, and the
                  // rows were 32px. The right padding leaves room for a new page's mark.
                  className={`w-full flex items-center gap-3 min-h-10 pl-3 rounded-md transition-colors ${whatsNew && !collapsed ? "pr-16" : "pr-2.5"} ${
                    isActive
                      ? "text-white bg-sidebar-accent font-medium"
                      : "text-sidebar-foreground hover:text-white hover:bg-sidebar-accent/60"
                  }`}
                  style={{ borderLeft: `3px solid ${isActive ? "var(--sidebar-primary)" : "transparent"}`, paddingLeft: "9px" }}
                >
                  <span className="relative shrink-0">
                    <Icon className="w-[18px] h-[18px]" />
                    {/* Collapsed, the rail has no room for the mark, so a dot says the page is new. */}
                    {whatsNew && collapsed && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400" aria-label="New" />}
                    {badge > 0 && collapsed && <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-red-500" aria-label={`${badge} waiting`} />}
                  </span>
                  {/* A label beside a New mark wraps rather than being cut off. */}
                  {!collapsed && <span className={whatsNew ? "leading-tight py-1" : "truncate"}>{label}</span>}
                  {badge > 0 && !collapsed && (
                    <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white" title={`${badge} asset${badge === 1 ? "" : "s"} waiting for Roblox links`}>
                      {badge}
                    </span>
                  )}
                </Link>
                {whatsNew && !collapsed && <WhatsNewMark label={label} entry={whatsNew} />}
              </div>
            );
        })}
      </div>

      <div className="shrink-0 border-t border-sidebar-border p-2 space-y-0.5">
        {/* Identity and sign-out live here rather than being repeated in the header of every page.
            There is no theme toggle: the app is dark for everyone (app/layout.tsx). */}
        {!collapsed && viewer.email && (
          <p className="px-3 pt-1 pb-2 text-xs text-sidebar-foreground truncate" title={viewer.email}>
            {viewer.email}
          </p>
        )}
        <div className={`flex items-center gap-1 ${collapsed ? "flex-col" : ""}`}>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            title="Sign out"
            aria-label="Sign out"
            className="h-9 flex-1 flex items-center justify-center gap-2 rounded-md text-sidebar-foreground hover:text-white hover:bg-sidebar-accent transition-colors"
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex w-full items-center gap-3 min-h-10 pl-3 pr-2.5 rounded-md text-sidebar-foreground hover:text-white hover:bg-sidebar-accent transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="w-[18px] h-[18px] shrink-0" /> : <PanelLeftClose className="w-[18px] h-[18px] shrink-0" />}
          {!collapsed && <span className="truncate">Collapse</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Phone: a button in the corner opens the panel over the page. The rail itself is hidden
          below md, where a fixed 224px of it left almost nothing for the content. */}
      <button
        type="button"
        onClick={() => setOpenedOnPath(pathname)}
        aria-label="Open menu"
        className="md:hidden fixed top-2.5 left-3 z-40 h-10 w-10 grid place-items-center rounded-lg border border-border bg-card text-foreground shadow-sm"
      >
        <Menu className="w-5 h-5" />
      </button>

      {mobileOpen && (
        <div
          onClick={() => setOpenedOnPath(null)}
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          aria-hidden="true"
        />
      )}

      <nav
        aria-label="Main"
        className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col h-full shrink-0 bg-sidebar border-r border-sidebar-border transition-transform md:transition-[width] duration-200 w-64 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${collapsed ? "md:w-16" : "md:w-56"}`}
      >
        {panel}
      </nav>
    </>
  );
}
