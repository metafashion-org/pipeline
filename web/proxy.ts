import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
    function proxy(req) {
        const path = req.nextUrl.pathname;
        const token = req.nextauth.token;

        if (path === "/login" || path === "/") {
            if (token && typeof token.email === "string" && token.email.trim() !== "") {
                // If status is not Active, deny
                if (token.status && token.status !== "Active") {
                    return NextResponse.redirect(new URL("/unauthorized", req.url));
                }

                const roles = (token.roles as string[]) || [];
                if (roles.includes("admin") || roles.includes("operator")) {
                    return NextResponse.redirect(new URL("/admin", req.url));
                }
                if (roles.includes("artist")) {
                    return NextResponse.redirect(new URL("/artist", req.url));
                }
                // A pure curator (no admin/operator/artist role) had nowhere
                // to land here before this — the redirect chain fell through
                // and left them stuck on "/" with no visible error.
                if (roles.includes("curator")) {
                    return NextResponse.redirect(new URL("/curator", req.url));
                }
                // Same gap as curator had: a pure publisher/uploader (no
                // admin/operator/artist/curator role) fell through with
                // nowhere to land.
                if (roles.includes("publisher") || roles.includes("uploader")) {
                    return NextResponse.redirect(new URL("/publisher", req.url));
                }
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

        const roles = (token.roles as string[]) || [];

        // Route protection
        if (path.startsWith("/admin")) {
            const hasAdminAccess = roles.includes("admin") || roles.includes("operator");
            if (!hasAdminAccess) {
                if (roles.includes("artist")) {
                    return NextResponse.redirect(new URL("/artist", req.url));
                }
                return NextResponse.redirect(new URL("/unauthorized", req.url));
            }
        }

        if (path.startsWith("/artist")) {
            const hasArtistAccess = roles.includes("artist") || roles.includes("admin") || roles.includes("operator");
            if (!hasArtistAccess) {
                return NextResponse.redirect(new URL("/unauthorized", req.url));
            }
        }

        if (path.startsWith("/curator")) {
            const hasCuratorAccess = roles.includes("curator") || roles.includes("admin") || roles.includes("operator");
            if (!hasCuratorAccess) {
                return NextResponse.redirect(new URL("/unauthorized", req.url));
            }
        }

        if (path.startsWith("/publisher")) {
            const hasPublisherAccess =
                roles.includes("publisher") || roles.includes("uploader") || roles.includes("admin") || roles.includes("operator");
            if (!hasPublisherAccess) {
                return NextResponse.redirect(new URL("/unauthorized", req.url));
            }
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
