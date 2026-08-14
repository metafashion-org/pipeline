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
                scope: "openid email profile https://www.googleapis.com/auth/spreadsheets",
                access_type: "offline",
                prompt: "consent",
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
                // time it reaches this code — Host is attacker-controlled at the HTTP level itself,
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
        async jwt({ token, account, user }) {
            if (account) {
                token.accessToken = account.access_token;
                token.refreshToken = account.refresh_token;
            }
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
            session.accessToken = token.accessToken as string | undefined;
            session.refreshToken = token.refreshToken as string | undefined;

            if (session.user && token.email) {
                session.user.personnelId = token.personnelId as string | undefined;
                session.user.roles = (token.roles as string[]) || [];
                session.user.status = token.status as string | undefined;
                session.user.capabilityOverrides = token.capabilityOverrides as Record<string, boolean> | undefined;
                
                // Backwards compatibility role string
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
