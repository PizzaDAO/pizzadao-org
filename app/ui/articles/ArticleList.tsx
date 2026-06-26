"use client";

// napoletana-41544 — Editorial restyle of the article list view.
//   • Gallery skeletons get paper-soft framing
//   • List rows read as printed index-card entries: overline category
//     label + display headline + uppercase byline + thumbnail framed
//   • Empty state uses display heading + handwritten margin note
// Same props, same data shape, same view-mode toggle.

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
      className="paper-soft bg-card border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius] overflow-hidden"
      style={{ animation: "pulse 1.5s infinite" }}
    >
      <div
        className="w-full bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
        style={{ aspectRatio: "16 / 9" }}
      />
      <div className="p-4 flex flex-col gap-2">
        <div className="h-3 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-1/3" />
        <div className="h-6 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-4/5" />
        <div className="h-3.5 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-full" />
        <div className="h-3.5 bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)] rounded-md w-3/5" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      className="paper-soft flex items-center gap-4 px-4 py-3 bg-card border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius]"
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
  const primaryTag = article.tags?.[0];

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="article-card paper-soft group flex items-center gap-4 px-4 py-3 bg-card text-card-foreground border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius] no-underline transition-all duration-200 hover:border-[hsl(var(--tomato)/0.65)] hover:-translate-y-px"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      {imageUrl && (
        <div className="w-20 h-14 rounded-md overflow-hidden flex-shrink-0 bg-[hsl(var(--ink)/0.04)] dark:bg-[hsl(var(--cream)/0.04)] border border-[hsl(var(--rule-warm)/0.45)]">
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
        {primaryTag && (
          <p className="overline text-tomato m-0 mb-0.5 truncate">{primaryTag}</p>
        )}
        <h3 className="font-display text-base sm:text-lg font-black text-foreground leading-snug m-0 whitespace-nowrap overflow-hidden text-ellipsis tracking-tight group-hover:text-tomato transition-colors">
          {article.title}
        </h3>
        <p className="overline m-0 mt-1 text-foreground/55 truncate">
          {article.authorName ? `By ${article.authorName}` : "—"}
          {displayDate ? (
            <>
              <span aria-hidden className="mx-1.5 opacity-50">·</span>
              {displayDate}
            </>
          ) : null}
        </p>
        {article.excerpt && (
          <p
            className="mt-1 mb-0 text-[13px] leading-snug text-foreground/65 whitespace-nowrap overflow-hidden text-ellipsis"
            style={{ textWrap: "pretty" }}
          >
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
              100% { opacity: 1; }
              50% { opacity: 0.5; }
            }
          `}</style>
        </div>
      );
    }
    return (
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}
      >
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <SkeletonCard key={i} />
        ))}
        <style jsx>{`
          @keyframes pulse {
            0%,
            100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    );
  }

  if (!articles || articles.length === 0) {
    return (
      <div className="paper-soft print-noise relative p-10 sm:p-14 text-center bg-card text-card-foreground border border-[hsl(var(--rule-warm)/0.55)] rounded-[--radius]">
        <p className="overline text-foreground/45 m-0">Quiet day at the office</p>
        <p
          className="font-display font-black tracking-tight text-foreground m-0 mt-3"
          style={{ fontSize: "clamp(1.4rem, 3vw, 2rem)", lineHeight: 1.05 }}
        >
          {emptyMessage}
        </p>
        <span
          aria-hidden
          className="handwritten mt-4 inline-block rotate-[-3deg] text-foreground/55"
          style={{ fontSize: 14 }}
        >
          check back soon
        </span>
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
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))" }}
    >
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} showStatus={showStatus} />
      ))}
    </div>
  );
}
