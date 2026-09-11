import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SWRProvider } from "@/components/providers/SWRProvider";

// Shared shell for every internal, logged-in page (admin/*, artist, curator, publisher). A route
// group, so it changes nothing about the URLs.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  // Read once here and handed to the sidebar, which needs the roles to decide which nav items to
  // show at all. Doing it on the server keeps the first paint correct and saves the client a
  // session request it would otherwise make on every page.
  const session = await getServerSession(authOptions);

  return (
    <SWRProvider>
      {/* h-dvh, not h-screen: on iOS Safari the browser chrome overlays a vh-sized element, which
          put the bottom of every page under the address bar. w-full rather than w-screen for the
          same reason a scrollbar used to push the layout sideways. */}
      <div className="flex h-dvh w-full overflow-hidden">
        <AppSidebar
          viewer={{
            email: session?.user?.email ?? null,
            roles: session?.user?.roles || [],
            capabilityOverrides: session?.user?.capabilityOverrides || {},
          }}
        />
        <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
      </div>
    </SWRProvider>
  );
}
