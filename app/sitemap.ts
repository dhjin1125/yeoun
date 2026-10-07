import type { MetadataRoute } from "next";
import { DREAM_TOPICS } from "@/lib/seo-topics";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3010").replace(/\/$/, "");
  const now = new Date("2026-08-18T00:00:00+09:00");
  return [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    ...DREAM_TOPICS.map((topic) => ({ url: `${base}/dreams/${topic.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: .75 })),
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly" as const, priority: .2 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly" as const, priority: .2 },
    { url: `${base}/refund`, lastModified: now, changeFrequency: "yearly" as const, priority: .2 }
  ];
}
