import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3010";
  return {
    rules: [{ userAgent: "*", allow: ["/", "/dreams/", "/privacy", "/terms", "/refund"], disallow: ["/api/", "/reading/", "/checkout/", "/auth/", "/login", "/products"] }],
    sitemap: `${baseUrl.replace(/\/$/, "")}/sitemap.xml`
  };
}
