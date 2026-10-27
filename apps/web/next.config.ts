import type { NextConfig } from "next";

const production = process.env["NODE_ENV"] === "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  `connect-src 'self'${production ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg"],
  transpilePackages: [
    "@cce/agents",
    "@cce/api-contracts",
    "@cce/application",
    "@cce/database",
    "@cce/domain",
    "@cce/model-provider",
    "@cce/shared",
  ],
  rewrites() {
    return Promise.resolve({
      beforeFiles:
        !production && process.env["CCE_VUE_DEV_SERVER"] === "1"
          ? [
              { source: "/vue", destination: "http://127.0.0.1:5173/vue/index.html" },
              { source: "/vue/:path*", destination: "http://127.0.0.1:5173/vue/:path*" },
            ]
          : [],
      afterFiles: [],
      fallback: [],
    });
  },
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(production
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
    ]);
  },
};

export default nextConfig;
