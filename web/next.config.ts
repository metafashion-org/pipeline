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
  experimental: {
    // How long the browser may reuse an already-fetched page from the client-side router cache
    // before asking the server for it again. Next's default for a dynamic page is 0, which is why
    // going Marketing -> Knowledge -> Marketing re-rendered the Marketing page on the server every
    // time, including the round trip. Thirty seconds covers moving between dashboard views without
    // holding a stale page long enough for anyone to act on it, and it only applies to navigation:
    // a reload always goes to the server.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
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
