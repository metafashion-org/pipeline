import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
