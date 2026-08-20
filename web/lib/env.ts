/**
 * Why? -> this is so MUCH MORE EASIER!! so easy to access :D
 * 1. type-safety: provides typed access to env vars (e.g. `ENV.ADMIN_EMAILS` is `string[]`)
 * 2. validation: fails fast at runtime if required variables are missing or invalid
 * 3. safety: ensures server-only secrets aren't bundled into client-side code
 * 4. transformation: automatically parses comma-separated lists into arrays
 */

import { z } from "zod";

const publicEnvSchema = z.object({
    NEXT_PUBLIC_APP_URL: z.url("NEXT_PUBLIC_APP_URL must be a valid URL"),
});

const emailListSchema = z.string().min(1).transform((val) => val.split(",").map((email) => email.trim())).pipe(z.array(z.email()));

const serverEnvSchema = z.object({
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1, "GOOGLE_OAUTH_CLIENT_ID is required"),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1, "GOOGLE_OAUTH_CLIENT_SECRET is required"),
    // Service account creds for the Drive image proxy (app/api/assets/[skuId]/image) -
    // unrelated to the removed Google Sheets integration, this is file storage.
    NEXTAUTH_URL: z.url("NEXTAUTH_URL is required"),
    NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
    ADMIN_EMAILS: z.string().optional().transform((val) => val ? val.split(",").map((e) => e.trim()) : []),
    ARTIST_EMAILS: z.string().optional().transform((val) => val ? val.split(",").map((e) => e.trim()) : []),
});

const isServer = typeof window === "undefined";

// Map variables explicitly for the client to ensure Next.js bundling works correctly
const runtimeEnv = isServer ? process.env : {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

const schema = isServer ? publicEnvSchema.extend(serverEnvSchema.shape) : publicEnvSchema;
const result = schema.safeParse(runtimeEnv);
// gatekeepers

if (!result.success) {
    console.error("[ERROR]: Invalid environment variables:", z.treeifyError(result.error));
    throw new Error("Environment validation failed");
}

export const ENV = result.data as z.infer<typeof publicEnvSchema> & z.infer<typeof serverEnvSchema>;
// validated environment object -> this combines both schemas, with seperate client and server validations
