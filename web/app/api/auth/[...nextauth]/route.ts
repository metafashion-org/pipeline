import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { ENV } from "@/lib/env";
import { getActivePersonnelByEmail } from "@/lib/auth/personnel-auth";

export const authOptions: NextAuthOptions = {
    providers: [
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
    ],
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
