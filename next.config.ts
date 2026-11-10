import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { extensionAlias: { ".js": [".tsx", ".ts", ".js"] } },
  webpack(config) {
    config.module = config.module ?? {};
    config.module.parser = { ...(config.module.parser ?? {}), javascript: { ...(config.module.parser?.javascript ?? {}), url: false } };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
