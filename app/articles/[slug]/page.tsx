import type { Metadata } from "next";
import { getArticleBySlug } from "@/app/lib/articles";
import ArticleDetailClient from "./ArticleDetailClient";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article || article.status !== "PUBLISHED") {
    return { title: "Article | PizzaDAO" };
  }

  const title = `${article.title} | PizzaDAO`;
  const description = article.excerpt || `By ${article.authorName || "PizzaDAO"}`;

  return {
    title,
    description,
    openGraph: {
      title: article.title,
      description,
      type: "article",
      publishedTime: article.publishedAt?.toISOString(),
      authors: article.authorName ? [article.authorName] : undefined,
      tags: article.tags,
      ...(article.coverImage ? { images: [{ url: article.coverImage, width: 1200, height: 630 }] } : {}),
      siteName: "PizzaDAO",
    },
    twitter: {
      card: article.coverImage ? "summary_large_image" : "summary",
      title: article.title,
      description,
      ...(article.coverImage ? { images: [article.coverImage] } : {}),
    },
  };
}

export default async function ArticleDetailPage({ params }: Props) {
  const { slug } = await params;
  return <ArticleDetailClient slug={slug} />;
}
