import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { isRouteAllowedForRoles, landingPathForRoles } from "@/lib/auth/rbac";

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
    function proxy(req) {
        const path = req.nextUrl.pathname;
        const token = req.nextauth.token;

        const roles = (token?.roles as string[]) || [];
        const overrides = (token?.capabilityOverrides as Record<string, boolean>) || {};

        if (path === "/login" || path === "/") {
            if (token && typeof token.email === "string" && token.email.trim() !== "") {
                if (token.status && token.status !== "Active") {
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
        if (token.status && token.status !== "Active") {
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
    matcher: ["/", "/login", "/admin/:path*", "/artist/:path*", "/curator/:path*", "/publisher/:path*"],
};
