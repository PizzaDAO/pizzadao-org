"use client";

// napoletana-41544 — Editorial restyle of the gallery article card.
// Each card reads like a press clipping: paper-soft tactile noise, an
// overline category label, a display-font headline with hover scribble,
// and a byline rendered in uppercase micro-type. Data shape unchanged.

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
  switch (s) {
    case "PUBLISHED":
      return "bg-[hsl(142_71%_45%/0.18)] text-[hsl(142_71%_25%)] dark:text-[hsl(142_71%_70%)]";
    case "ARCHIVED":
      return "bg-[hsl(var(--ink)/0.10)] text-[hsl(var(--ink-soft))] dark:bg-[hsl(var(--cream)/0.10)] dark:text-[hsl(var(--cream))]";
    case "DRAFT":
    default:
      return "bg-[hsl(var(--butter)/0.35)] text-[hsl(var(--ink))]";
  }
}

interface ArticleCardProps {
  article: ArticleCardData;
  showStatus?: boolean;
}

export default function ArticleCard({ article, showStatus = false }: ArticleCardProps) {
  const displayDate = formatDate(article.publishedAt || article.createdAt);
  const imageUrl = article.coverImage || article.thumbnail;
  const primaryTag = article.tags?.[0];

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="article-card paper-soft print-noise group flex flex-col bg-card text-card-foreground rounded-[--radius] border border-[hsl(var(--rule-warm)/0.55)] overflow-hidden no-underline transition-all duration-300 hover:border-[hsl(var(--tomato)/0.65)] hover:-translate-y-0.5"
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      {imageUrl && (
        <div
          className="w-full bg-[hsl(var(--ink)/0.04)] dark:bg-[hsl(var(--cream)/0.04)] overflow-hidden border-b border-[hsl(var(--rule-warm)/0.45)]"
          style={{ aspectRatio: "16 / 9" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover block transition-transform duration-500 group-hover:scale-[1.04]"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div className="p-4 sm:p-5 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2 min-h-[14px]">
          <span className="overline text-tomato truncate">
            {primaryTag ? primaryTag : "Dispatch"}
          </span>
          {showStatus && (
            <span
              className={`overline px-1.5 py-0.5 rounded-md shrink-0 ${statusBadgeClass(article.status)}`}
              style={{ fontSize: 10 }}
            >
              {article.status}
            </span>
          )}
        </div>

        <h3
          className="font-display text-xl sm:text-[1.35rem] font-black leading-[1.05] tracking-tight text-foreground m-0 group-hover:text-tomato transition-colors"
          style={{ textWrap: "balance" }}
        >
          {article.title}
        </h3>

        {article.excerpt && (
          <p
            className="text-sm leading-relaxed text-foreground/65 m-0 overflow-hidden"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              textWrap: "pretty",
            }}
          >
            {article.excerpt}
          </p>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between gap-2 border-t border-[hsl(var(--rule-warm)/0.45)]">
          <p className="overline m-0 text-foreground/55 truncate">
            {article.authorName ? `By ${article.authorName}` : "—"}
            {displayDate ? (
              <>
                <span aria-hidden className="mx-1.5 opacity-50">·</span>
                {displayDate}
              </>
            ) : null}
          </p>
        </div>

        {article.tags && article.tags.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {article.tags.slice(1, 4).map((tag) => (
              <TagBadge key={tag} tag={tag} size="sm" />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
