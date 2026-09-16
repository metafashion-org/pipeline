import NextAuth, { NextAuthOptions } from "next-auth";
import { Provider } from "next-auth/providers/index";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { ENV } from "@/lib/env";
import { getActivePersonnelByEmail } from "@/lib/auth/personnel-auth";

// Test-only login path for Playwright e2e, gated so it can never be reachable in production.
// Gate A: PLAYWRIGHT_TEST_LOGIN must be explicitly set to "true".
// Gate B: NODE_ENV must not be "production" (Next.js defaults NODE_ENV to "production" for both build and start unless overridden).
// Gate D: VERCEL must be unset, which structurally excludes every Vercel deployment regardless of how NODE_ENV resolves there.
// All three are checked once at module load, so a misconfigured env var can't flip this at request time.
const TEST_LOGIN_ENABLED =
    process.env.PLAYWRIGHT_TEST_LOGIN === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL;

const providers: Provider[] = [
    GoogleProvider({
        clientId: ENV.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: ENV.GOOGLE_OAUTH_CLIENT_SECRET,
        authorization: {
            params: {
                // Sign-in only. These three scopes are non-sensitive, so Google shows the plain
                // account chooser instead of the "this app hasn't been verified" interstitial and
                // no OAuth verification review is needed. The app previously also asked for
                // .../auth/spreadsheets, which is a sensitive scope: that is what put the warning
                // screen in front of every user and capped the app at its test-user list. Nothing
                // reads a user's Sheets any more (the Sheets integration was removed), and the
                // Drive work in lib/assets/drive-upload.ts runs on a service account, not on the
                // signed-in person's token, so no Google API scope belongs here.
                //
                // Adding any googleapis.com scope back reinstates the warning screen. Use the
                // service account instead unless the feature genuinely has to act as the user.
                scope: "openid email profile",
            }
        }
    }),
];

if (TEST_LOGIN_ENABLED) {
    providers.push(
        CredentialsProvider({
            id: "test-login",
            name: "Test Login",
            credentials: {
                email: { label: "Email", type: "text" },
            },
            async authorize(credentials, req) {
                // Gate C: defense-in-depth, checked per request. Only reliable when edge routing
                // guarantees an external request can never carry Host: localhost/127.0.0.1 by the
                // time it reaches this code - Host is attacker-controlled at the HTTP level itself,
                // so this check alone is not a security boundary, gates A/B/D are.
                const host = req.headers?.host ?? "";
                if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return null;

                const email = credentials?.email?.trim().toLowerCase();
                if (!email) return null;

                const authResult = await getActivePersonnelByEmail(email);
                if (!authResult.isAllowed || !authResult.personnelId) return null;

                return { id: authResult.personnelId, email };
            },
        })
    );
}

export const authOptions: NextAuthOptions = {
    providers,
    callbacks: {
        async signIn({ user }) {
            const email = user.email?.toLowerCase() || "";
            if (!email) return "/unauthorized";

            // Query DB personnel table, gated strictly on status = 'Active'
            const authResult = await getActivePersonnelByEmail(email);
            if (authResult.isAllowed) {
                return true;
            }

            return "/unauthorized";
        },
        async jwt({ token }) {
            if (token.email) {
                const authResult = await getActivePersonnelByEmail(token.email);
                token.personnelId = authResult.personnelId;
                token.roles = authResult.roles;
                token.status = authResult.status;
                token.capabilityOverrides = authResult.capabilityOverrides;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user && token.email) {
                const status = token.status as string | undefined;
                session.user.status = status;

                // A session for someone who is no longer Active carries no authority.
                //
                // proxy.ts already redirects them away from every page route, but its matcher
                // covers pages only — never "/api" — so before this, all 42 API routes still
                // accepted a blacklisted person's still-valid JWT with their original roles.
                // Emptying the identity here is what makes setPersonnelStatus and
                // invalidatePersonnelAuthCache mean what their comments say: revoking a
                // departed freelancer takes effect on their next request, everywhere, without
                // each route having to remember to check.
                //
                // The session object itself stays (NextAuth has no way to return "no session"
                // from here), so routes that check only `if (!session)` still see one — hence
                // the capability checks in the routes remain the real gate, and this is the
                // layer underneath them.
                if (status !== "Active") {
                    session.user.personnelId = undefined;
                    session.user.roles = [];
                    session.user.capabilityOverrides = {};
                    session.user.role = undefined;
                    return session;
                }

                session.user.personnelId = token.personnelId as string | undefined;
                session.user.roles = (token.roles as string[]) || [];
                session.user.capabilityOverrides = token.capabilityOverrides as Record<string, boolean> | undefined;

                // Deprecated single-role string, kept for the page routes that still branch on
                // it. It cannot represent curator, publisher, marketing or payment_admin — all
                // four collapse to "artist" — so anything making an authorization decision
                // should read session.user.roles through getEffectiveCapabilities instead.
                const roles = session.user.roles;
                if (roles.includes("admin")) {
                    session.user.role = "admin";
                } else if (roles.includes("operator")) {
                    session.user.role = "operator";
                } else {
                    session.user.role = "artist";
                }
            }

            return session;
        }
    },
    pages: {
        signIn: "/login",
        error: "/unauthorized",
    },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
