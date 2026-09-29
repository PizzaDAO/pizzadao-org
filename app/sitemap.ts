import type { MetadataRoute } from "next";
import { SITE_URL } from "@/app/lib/site-url";
import { prisma } from "@/app/lib/db";
import { getCrewMappings } from "@/app/lib/crew-mappings";

// Regenerate at most hourly; dynamic sections are best-effort so a DB or
// sheet outage still yields the static routes.
export const revalidate = 3600;

const STATIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/join", priority: 0.9, changeFrequency: "monthly" },
  { path: "/crews", priority: 0.8, changeFrequency: "weekly" },
  { path: "/crew", priority: 0.6, changeFrequency: "daily" },
  { path: "/articles", priority: 0.8, changeFrequency: "daily" },
  { path: "/missions", priority: 0.6, changeFrequency: "weekly" },
  { path: "/calls", priority: 0.6, changeFrequency: "daily" },
  { path: "/manuals", priority: 0.6, changeFrequency: "weekly" },
  { path: "/turtles", priority: 0.5, changeFrequency: "monthly" },
  { path: "/tech/projects", priority: 0.5, changeFrequency: "weekly" },
  { path: "/nfts", priority: 0.4, changeFrequency: "monthly" },
  { path: "/poaps", priority: 0.4, changeFrequency: "weekly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path === "/" ? "" : r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  const [articles, crews] = await Promise.allSettled([
    prisma.article.findMany({
      where: { status: "PUBLISHED" },
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 1000,
    }),
    getCrewMappings(),
  ]);

  if (articles.status === "fulfilled") {
    for (const a of articles.value) {
      entries.push({
        url: `${SITE_URL}/articles/${encodeURIComponent(a.slug)}`,
        lastModified: a.updatedAt,
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  }

  if (crews.status === "fulfilled") {
    for (const c of crews.value.crews) {
      if (!c.id) continue;
      entries.push({
        url: `${SITE_URL}/crew/${encodeURIComponent(c.id)}`,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  return entries;
}
