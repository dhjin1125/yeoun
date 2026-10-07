import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";
const isVercelBuild = Boolean(process.env.VERCEL);
const isNodeOffReviewSite = process.env.NODEOFF_REVIEW_SITE === "true";
// The review domain keeps Vercel as its public edge while IWINV owns durable SQLite state.
const iwinvReviewOrigin = "https://dream.115.68.230.104.sslip.io";

const nodeOffSharedApiPaths = [
  "/api/access",
  "/api/events",
  "/api/healthz",
  "/api/readyz",
  "/api/readings",
  "/api/readings/:id",
  "/api/readings/:id/clarifications",
  "/api/readings/:id/details",
  "/api/readings/:id/follow-up",
  "/api/readings/:id/messages",
  "/api/readings/:id/retry"
];

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://js.tosspayments.com https://cdn.portone.io`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://api.tosspayments.com https://api.portone.io https://checkout-service.prod.iamport.co https://coretelemetry.prod.iamport.co https://payment-bridge.prod.iamport.co https://tx-gateway-service.prod.iamport.co",
  "frame-src https://*.tosspayments.com https://pay.tosspayments.com https://checkout-service.prod.iamport.co https://payment-bridge.prod.iamport.co https://service.iamport.kr https://*.kcp.co.kr",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.tosspayments.com https://checkout-service.prod.iamport.co https://payment-bridge.prod.iamport.co https://tx-gateway-service.prod.iamport.co https://service.iamport.kr https://*.kcp.co.kr",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

const nextConfig: NextConfig = {
  // Aside and local testing use the loopback IP as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Vercel supplies its own Next.js build adapter. Next 16.3 currently omits
  // the root trace file when that adapter and standalone output are combined.
  // Keep standalone artifacts for self-hosting, but let Vercel use its native output.
  output: isVercelBuild ? undefined : "standalone",
  // Private experiments and test artifacts must never enter a public release.
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./tests/**/*", "./tmp/**/*", "./output/**/*"]
  },
  typedRoutes: false,
  async rewrites() {
    if (!isVercelBuild) return [];
    if (isNodeOffReviewSite) {
      return {
        beforeFiles: nodeOffSharedApiPaths.map((path) => ({
          source: path,
          destination: `${iwinvReviewOrigin}${path}`
        })),
        afterFiles: [],
        fallback: []
      };
    }
    return {
      beforeFiles: [
        {
          source: "/:path*",
          destination: `${iwinvReviewOrigin}/:path*`
        }
      ],
      afterFiles: [],
      fallback: []
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
        ]
      },
      {
        source: "/reading/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" }
        ]
      }
    ];
  }
};

export default nextConfig;
