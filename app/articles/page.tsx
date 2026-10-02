import type { Metadata } from "next";
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

// The first page of published articles is rendered on the server and
// regenerated at most every 5 minutes (same window as the /api/articles
// CDN cache). Search, tag filters, pagination and drafts still run in the
// client against /api/articles.
export const revalidate = 300;

const PAGE_LIMIT = 12;

async function loadFirstPage(): Promise<ArticlesPage | null> {
  try {
    const result = await getPublishedArticles({ page: 1, limit: PAGE_LIMIT });
    // Same list shape as GET /api/articles: thumbnail computed, content
    // stripped, and Dates serialized to ISO strings.
    const articles = result.articles.map(({ content, ...rest }) => ({
      ...rest,
      thumbnail: rest.coverImage || extractFirstImage(content) || null,
    }));
    return JSON.parse(JSON.stringify({ articles, pagination: result.pagination })) as {
      articles: ArticleCardData[];
      pagination: ArticlesPage["pagination"];
    };
  } catch {
    // DB unavailable (e.g. at build time): the client fetches on mount instead.
    return null;
  }
}

export default async function ArticlesPage() {
  const initial = await loadFirstPage();
  return <ArticlesClient initial={initial} />;
}
