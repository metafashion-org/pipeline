import { AppSidebar } from "@/components/layout/AppSidebar";

// Shared shell for every internal, logged-in-only page (admin/*, artist,
// curator, publisher) — a route group, so it changes nothing about the
// URLs themselves. Previously only admin/* had this; artist/curator/
// publisher each stood completely alone with their own full-page shell and
// no sidebar, which is what made clicking between tools feel like the
// sidebar kept disappearing. One shell now, one sidebar, always present -
// see AppSidebar's own collapse toggle for the "hideable, not forced" part.
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <AppSidebar />
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
