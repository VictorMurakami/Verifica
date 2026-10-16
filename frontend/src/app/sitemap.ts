import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL.href, lastModified: new Date(), changeFrequency: "monthly", priority: 1 },
    { url: new URL("/privacy", SITE_URL).href, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
