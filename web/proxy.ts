import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { isRouteAllowedForRoles, landingPathForRoles } from "@/lib/auth/rbac";
import { getActivePersonnelByEmail } from "@/lib/auth/personnel-auth";

// Page-route gating.
//
// This used to carry its own hardcoded, role-name-only copy of the rules, while
// lib/auth/rbac.ts held a capability-aware version that was covered by tests and called by
// nothing. Two authorization models that could disagree, with the tested one guarding no real
// route — and because this copy never consulted capabilityOverrides, the per-person capability
// data (503 personnel rows carry ten capability booleans each) had no effect on what anyone
// could open. There is one model now, and it is the tested one.
//
// Note this matcher covers pages only, never /api. API routes authorise themselves through
// lib/auth/authed-user.ts, which is also what checks that the person is still Active.
export default withAuth(
    async function proxy(req) {
        const path = req.nextUrl.pathname;
        const token = req.nextauth.token;

        // The sign-in cookie holds the roles a person had when they signed in, and nothing
        // rewrites it afterwards (there's no SessionProvider, and server components can't set
        // cookies). So someone given a role later, like full_time for Team Tasks, was redirected
        // away until they signed out and in again. Their current personnel row decides instead,
        // through the same 60-second cache the session callback uses; the cookie's copy is only
        // the fallback when the row can't be read.
        const current = typeof token?.email === "string" && token.email.trim() ? await getActivePersonnelByEmail(token.email) : null;
        const known = Boolean(current?.personnelId);
        const roles = known ? current!.roles : (token?.roles as string[]) || [];
        const overrides = known ? current!.capabilityOverrides || {} : (token?.capabilityOverrides as Record<string, boolean>) || {};
        const status = known ? current!.status : (token?.status as string | undefined);

        if (path === "/login" || path === "/") {
            if (token && typeof token.email === "string" && token.email.trim() !== "") {
                if (status && status !== "Active") {
                    return NextResponse.redirect(new URL("/unauthorized", req.url));
                }
                return NextResponse.redirect(new URL(landingPathForRoles(roles, overrides), req.url));
            }
            return NextResponse.next();
        }

        // Protected routes gatekeeping
        if (!token || typeof token.email !== "string" || token.email.trim() === "") {
            return NextResponse.redirect(new URL("/login", req.url));
        }

        // Gate strictly on Active status
        if (status && status !== "Active") {
            return NextResponse.redirect(new URL("/unauthorized", req.url));
        }

        if (!isRouteAllowedForRoles(path, roles, overrides)) {
            // Send them somewhere they can actually use rather than a dead end, unless there is
            // nowhere — then say so plainly.
            const landing = landingPathForRoles(roles, overrides);
            return NextResponse.redirect(new URL(landing === path ? "/unauthorized" : landing, req.url));
        }

        return NextResponse.next();
    },
    {
        callbacks: {
            authorized: ({ req, token }) => {
                const path = req.nextUrl.pathname;
                if (path === "/" || path === "/login") {
                    return true;
                }
                if (!token || typeof token.email !== "string" || token.email.trim() === "") {
                    return false;
                }
                return true;
            }
        },
    }
);

export const config = {
    matcher: ["/", "/login", "/admin/:path*", "/artist/:path*", "/curator/:path*", "/publisher/:path*", "/team/:path*"],
};
