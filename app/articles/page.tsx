import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { getPublishedArticles, extractFirstImage } from "@/app/lib/articles";
import type { ArticleCardData } from "@/app/ui/articles";
import ArticlesClient, { type ArticlesPage } from "./ArticlesClient";

export const metadata: Metadata = {
  title: "Articles",
  description: "Stories, updates and essays from the PizzaDAO family.",
  alternates: { canonical: "/articles" },
  openGraph: {
    title: "Articles · PizzaDAO",
    description: "Stories, updates and essays from the PizzaDAO family.",
    url: "/articles",
  },
};

const PAGE_LIMIT = 12;

/** Cache tag for the server-rendered first page of /articles (revalidateTag-able). */
const ARTICLES_LIST_CACHE_TAG = "articles-list";

// First page of published articles in the list shape GET /api/articles
// returns (thumbnail computed, content stripped, Dates as ISO strings).
// Cached for 5 minutes, the same window as the /api/articles CDN cache.
const getFirstPage = unstable_cache(
  async (): Promise<ArticlesPage> => {
    const result = await getPublishedArticles({ page: 1, limit: PAGE_LIMIT });
    const articles = result.articles.map(({ content, ...rest }) => ({
      ...rest,
      thumbnail: rest.coverImage || extractFirstImage(content) || null,
    }));
    return JSON.parse(JSON.stringify({ articles, pagination: result.pagination })) as {
      articles: ArticleCardData[];
      pagination: ArticlesPage["pagination"];
    };
  },
  ["articles-first-page", String(PAGE_LIMIT)],
  { revalidate: 300, tags: [ARTICLES_LIST_CACHE_TAG] },
);

export default async function ArticlesIndexPage() {
  let initial: ArticlesPage | null = null;
  try {
    initial = await getFirstPage();
  } catch {
    // DB unavailable: the client fetches /api/articles on mount instead.
  }
  // Search, tag filters, pagination and drafts stay client-side.
  return <ArticlesClient initial={initial} />;
}
