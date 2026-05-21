"use client";

import Link from "next/link";
import ArticleCard, { type ArticleCardData, formatDate } from "./ArticleCard";
import TagBadge from "./TagBadge";

export type ViewMode = "gallery" | "list";

interface ArticleListProps {
  articles: ArticleCardData[];
  loading?: boolean;
  emptyMessage?: string;
  showStatus?: boolean;
  viewMode?: ViewMode;
}

function SkeletonCard() {
  return (
    <div
      className="bg-card border border-[hsl(var(--rule)/0.12)] rounded-[--radius] overflow-hidden"
      style={{ animation: "pulse 1.5s infinite" }}
    >
      <div
        className="w-full bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
        style={{ aspectRatio: "16 / 9" }}
      />
      <div className="p-4 flex flex-col gap-2">
        <div className="h-5 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-4/5" />
        <div className="h-3.5 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-full" />
        <div className="h-3.5 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-3/5" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3 bg-card border border-[hsl(var(--rule)/0.12)] rounded-[--radius]"
      style={{ animation: "pulse 1.5s infinite" }}
    >
      <div className="w-20 h-14 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="h-4 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-3/5" />
        <div className="h-3 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-2/5" />
      </div>
    </div>
  );
}

function ArticleListRow({ article }: { article: ArticleCardData }) {
  const displayDate = formatDate(article.publishedAt || article.createdAt);
  const imageUrl = article.coverImage || article.thumbnail;

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="article-card flex items-center gap-4 px-4 py-3 bg-card text-card-foreground border border-[hsl(var(--rule)/0.12)] rounded-[--radius] no-underline transition-all duration-200 hover:border-[hsl(var(--tomato)/0.50)] hover:-translate-y-px hover:shadow-[0_4px_16px_hsl(var(--ink)/0.08)]"
    >
      {imageUrl && (
        <div className="w-20 h-14 rounded-md overflow-hidden flex-shrink-0 bg-[hsl(var(--ink)/0.04)] dark:bg-[hsl(var(--cream)/0.04)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover block"
            onError={(e) => {
              (e.target as HTMLImageElement).parentElement!.style.display = "none";
            }}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3
          className="font-display text-base font-bold text-foreground leading-snug m-0 whitespace-nowrap overflow-hidden text-ellipsis"
        >
          {article.title}
        </h3>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          <span>
            {article.authorName ? `by ${article.authorName}` : ""}
            {displayDate ? ` · ${displayDate}` : ""}
          </span>
        </div>
        {article.excerpt && (
          <p className="mt-1 mb-0 text-[13px] leading-snug text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
            {article.excerpt}
          </p>
        )}
      </div>
      {article.tags && article.tags.length > 0 && (
        <div className="hidden sm:flex flex-wrap gap-1 flex-shrink-0 max-w-[200px]">
          {article.tags.slice(0, 3).map((tag) => (
            <TagBadge key={tag} tag={tag} size="sm" />
          ))}
        </div>
      )}
    </Link>
  );
}

export default function ArticleList({
  articles,
  loading = false,
  emptyMessage = "No articles yet.",
  showStatus = false,
  viewMode = "gallery",
}: ArticleListProps) {
  if (loading) {
    if (viewMode === "list") {
      return (
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonRow key={i} />
          ))}
          <style jsx>{`
            @keyframes pulse {
              0%,
              100% {
                opacity: 1;
              }
              50% {
                opacity: 0.5;
              }
            }
          `}</style>
        </div>
      );
    }
    return (
      <div
        className="grid gap-5"
        // sicilian-41551: min(280px, 100%) so cards collapse to a single
        // column on narrow viewports instead of overflowing.
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}
      >
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <SkeletonCard key={i} />
        ))}
        <style jsx>{`
          @keyframes pulse {
            0%,
            100% {
              opacity: 1;
            }
            50% {
              opacity: 0.5;
            }
          }
        `}</style>
      </div>
    );
  }

  if (!articles || articles.length === 0) {
    return (
      <div className="p-10 text-center bg-card text-card-foreground border border-[hsl(var(--rule)/0.12)] rounded-[--radius]">
        <p className="text-base text-muted-foreground m-0">{emptyMessage}</p>
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="flex flex-col gap-2">
        {articles.map((article) => (
          <ArticleListRow key={article.id} article={article} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid gap-5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
    >
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} showStatus={showStatus} />
      ))}
    </div>
  );
}
