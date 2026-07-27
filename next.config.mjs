// @ts-check
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
const production = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js dev/hydration needs inline; no external script hosts.
      `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // ws: for dev HMR and the same-origin noVNC proxy
      `connect-src 'self'${production ? " wss:" : " ws: wss:"}`,
      "frame-ancestors 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  ...(production
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "ws", "nodemailer"],
  // Cumulet has no next/image usage. Keep libvips/Sharp out of the runtime
  // image until Next's stable dependency range includes the patched release.
  images: { unoptimized: true },
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
};

export default withNextIntl(nextConfig);
