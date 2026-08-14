import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { ENV } from "@/lib/env";

export async function GET(
    request: NextRequest,
) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const driveId = request.nextUrl.searchParams.get("driveId");
    if (!driveId) return new NextResponse("Missing Drive ID", { status: 400 });

    try {
        let auth;

        // prioritize service account (definitive for private files)
        if (ENV.GOOGLE_CLIENT_EMAIL && ENV.GOOGLE_PRIVATE_KEY) {
            auth = new google.auth.JWT({
                email: ENV.GOOGLE_CLIENT_EMAIL,
                key: ENV.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
                scopes: ["https://www.googleapis.com/auth/drive.readonly"]
            });
        } else if (session.accessToken) {
            // fallback: use current user's token (works ONLY if they have permission)
            auth = new google.auth.OAuth2();
            auth.setCredentials({ access_token: session.accessToken });
        } else {
            return new NextResponse("No credentials to fetch Drive file", { status: 403 });
        }

        const drive = google.drive({ version: "v3", auth });

        // 1. Fetch file stream
        const response = await drive.files.get(
            { fileId: driveId, alt: "media" },
            { responseType: "stream" }
        );

        // 2. Fetch mimeType for correct headers
        const metadata = await drive.files.get({ fileId: driveId, fields: "mimeType" });
        const contentType = metadata.data.mimeType || "image/jpeg";

        return new NextResponse(response.data as unknown as ReadableStream, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("Drive Proxy Error:", error);
        return new NextResponse("Error fetching image", { status: 500 });
    }
}
