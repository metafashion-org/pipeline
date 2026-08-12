import "next-auth";

declare module "next-auth" {
    interface Session {
        accessToken?: string;
        refreshToken?: string;
        user: {
            email?: string | null;
            name?: string | null;
            role?: string;
            roles?: string[];
            personnelId?: string;
            status?: string;
            capabilityOverrides?: Record<string, boolean>;
        };
    }

    interface JWT {
        accessToken?: string;
        refreshToken?: string;
        email?: string;
        personnelId?: string;
        roles?: string[];
        status?: string;
        capabilityOverrides?: Record<string, boolean>;
    }
}
