"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, KanbanSquare, Archive, Megaphone, Settings, Users } from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/board", icon: KanbanSquare, label: "Board" },
  { href: "/admin/archive", icon: Archive, label: "Archive" },
  { href: "/admin/personnel", icon: Users, label: "Personnel" },
  { href: "/admin/marketing", icon: Megaphone, label: "Marketing" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col items-center gap-1 w-16 h-screen shrink-0 bg-zinc-950 py-4 border-r border-zinc-800">
      {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
        const isActive = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={`flex items-center justify-center w-10 h-10 rounded-lg transition-colors ${
              isActive ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            <Icon className="w-5 h-5" />
          </Link>
        );
      })}
    </nav>
  );
}
