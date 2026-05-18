"use client";

import Link from "next/link";
import TagBadge from "./TagBadge";

export interface ArticleCardData {
  id: number;
  slug: string;
  title: string;
  excerpt?: string | null;
  coverImage?: string | null;
  thumbnail?: string | null;
  authorId: string;
  authorName?: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  tags: string[];
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export function formatDate(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function statusBadgeClass(status: string) {
  const s = status.toUpperCase();
  // Tokenized status pills consistent with the rest of the app.
  switch (s) {
    case "PUBLISHED":
      return "bg-[hsl(142_71%_45%/0.18)] text-[hsl(142_71%_25%)] dark:text-[hsl(142_71%_70%)]";
    case "ARCHIVED":
      return "bg-[hsl(var(--ink)/0.10)] text-[hsl(var(--ink-soft))] dark:bg-[hsl(var(--cream)/0.10)] dark:text-[hsl(var(--cream))]";
    case "DRAFT":
    default:
      return "bg-[hsl(var(--butter)/0.30)] text-[hsl(var(--ink))]";
  }
}

interface ArticleCardProps {
  article: ArticleCardData;
  showStatus?: boolean;
}

export default function ArticleCard({ article, showStatus = false }: ArticleCardProps) {
  const displayDate = formatDate(article.publishedAt || article.createdAt);
  const imageUrl = article.coverImage || article.thumbnail;

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="article-card group flex flex-col bg-card text-card-foreground rounded-[--radius] border border-[hsl(var(--rule)/0.12)] overflow-hidden no-underline transition-all duration-200 hover:border-[hsl(var(--tomato)/0.50)] hover:-translate-y-0.5 hover:shadow-[0_8px_30px_hsl(var(--ink)/0.10)]"
    >
      {imageUrl && (
        <div
          className="w-full bg-[hsl(var(--ink)/0.04)] dark:bg-[hsl(var(--cream)/0.04)] overflow-hidden"
          style={{ aspectRatio: "16 / 9" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover block transition-transform duration-300 group-hover:scale-[1.02]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3
            className="font-display text-lg font-bold leading-tight text-foreground m-0"
            style={{ textWrap: "balance" }}
          >
            {article.title}
          </h3>
          {showStatus && (
            <span
              className={`inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md ${statusBadgeClass(article.status)}`}
            >
              {article.status}
            </span>
          )}
        </div>

        {article.excerpt && (
          <p
            className="text-sm leading-relaxed text-muted-foreground m-0 overflow-hidden"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
          >
            {article.excerpt}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
          <span>
            {article.authorName ? `by ${article.authorName}` : ""}
            {displayDate ? ` · ${displayDate}` : ""}
          </span>
        </div>

        {article.tags && article.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {article.tags.slice(0, 4).map((tag) => (
              <TagBadge key={tag} tag={tag} size="sm" />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
