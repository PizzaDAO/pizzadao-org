// app/lib/newsletter/sources/articles.ts
//
// "New articles": published member articles since the last issue, newest first, capped. The excerpt
// is the article's own excerpt (or its first characters, Markdown stripped); no model rewrites it.
// The section is omitted entirely when there are none.
import { prisma } from "@/app/lib/db";
import { SITE_URL } from "@/app/lib/site-url";
import type { ArticleItem } from "../sections";

export interface ArticleRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverImage: string | null;
  authorName: string | null;
  publishedAt: Date | null;
}

const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Markdown reduced to plain text (headings, emphasis, links, images, code fences, list markers, quotes). */
export function stripMarkdown(md: string): string {
  return oneLine(
    md
      .replace(/```[\s\S]*?```/gu, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/gu, " ")
      .replace(/^\s{0,3}(#{1,6}|[-*+>]|\d+\.)\s+/gm, "")
      .replace(/[*_~`]+/g, ""),
  );
}

export function articleExcerpt(a: Pick<ArticleRow, "excerpt" | "content">, chars = 200): string {
  const own = stripMarkdown(a.excerpt ?? "");
  return clip(own || stripMarkdown(a.content), chars);
}

/** The window: published after `since` and up to `until`, newest first, at most `max`. Pure over rows. */
export function selectArticles(rows: ArticleRow[], since: Date, until: Date, max: number, base: string = SITE_URL): ArticleItem[] {
  return rows
    .filter((r) => r.publishedAt && r.publishedAt > since && r.publishedAt <= until)
    .sort((a, b) => b.publishedAt!.getTime() - a.publishedAt!.getTime())
    .slice(0, max)
    .map((r) => ({
      id: String(r.id),
      title: clip(oneLine(r.title), 300),
      author: clip(oneLine(r.authorName ?? ""), 120),
      excerpt: articleExcerpt(r),
      coverImage: r.coverImage && /^https:\/\//i.test(r.coverImage) ? r.coverImage.slice(0, 500) : "",
      url: `${base.replace(/\/$/, "")}/articles/${encodeURIComponent(r.slug)}`,
      included: true,
    }));
}

export async function gatherArticles(since: Date, until: Date, max: number): Promise<ArticleItem[]> {
  const rows = await prisma.article.findMany({
    where: { status: "PUBLISHED", publishedAt: { gt: since, lte: until } },
    orderBy: { publishedAt: "desc" },
    take: max,
    select: { id: true, slug: true, title: true, excerpt: true, content: true, coverImage: true, authorName: true, publishedAt: true },
  });
  return selectArticles(rows, since, until, max);
}
