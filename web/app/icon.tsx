import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Replaces Next.js's stock default favicon (a generic black triangle) with a
// real one — same mark as the sidebar's brand block (App.tsx / AppSidebar):
// a blue square, Catalog Intel's own #2962ff accent, with a white "M".
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2962ff",
          borderRadius: 7,
          color: "#ffffff",
          fontSize: 20,
          fontWeight: 700,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        M
      </div>
    ),
    { ...size }
  );
}
