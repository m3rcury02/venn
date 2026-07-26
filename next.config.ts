import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Vercel/browsers would otherwise cache this indefinitely, which
        // would leave every deploy's offline behavior stuck on whatever
        // sw.js a client fetched first.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
