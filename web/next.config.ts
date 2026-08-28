import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No basePath: this app moved from a /pipeline path under Catalog Intel's
  // domain to its own subdomain (kanban.metafashion.in), so it serves at the
  // domain root like any normal app. If this ever needs to move back under a
  // shared domain as a path prefix again, `basePath: "/pipeline"` is what
  // that took — see git history on this file.
  // This app now lives nested inside Catalog Intel's own npm project (a
  // package-lock.json one level up), which makes Turbopack guess the wrong
  // workspace root without this — pin it explicitly to this directory.
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "**",
      },
      {
        // Reference images are served from Drive's thumbnail endpoint, which redirects to lh3.googleusercontent.com above.
        protocol: "https",
        hostname: "drive.google.com",
        pathname: "/thumbnail",
      },
    ],
  },
};

export default nextConfig;
