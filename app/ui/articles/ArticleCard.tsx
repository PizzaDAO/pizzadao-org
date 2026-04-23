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

function statusBadge(status: string) {
  const s = status.toUpperCase();
  const colors: Record<string, { bg: string; color: string }> = {
    DRAFT: { bg: "#f59e0b", color: "white" },
    PUBLISHED: { bg: "#22c55e", color: "white" },
    ARCHIVED: { bg: "#6b7280", color: "white" },
  };
  const c = colors[s] || colors.DRAFT;
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: c.bg,
    color: c.color,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
  };
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
      className="article-card"
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface)",
        borderRadius: 12,
        border: "1px solid var(--color-border)",
        textDecoration: "none",
        color: "inherit",
        overflow: "hidden",
        transition: "all 0.2s ease",
      }}
    >
      {imageUrl && (
        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            background: "var(--color-surface-hover, rgba(0,0,0,0.04))",
            overflow: "hidden",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 17,
              fontWeight: 700,
              color: "var(--color-text-primary, var(--color-text))",
              lineHeight: 1.3,
            }}
          >
            {article.title}
          </h3>
          {showStatus && <span style={statusBadge(article.status)}>{article.status}</span>}
        </div>

        {article.excerpt && (
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.5,
              color: "var(--color-text-secondary, var(--color-text))",
              opacity: 0.85,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {article.excerpt}
          </p>
        )}

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 12,
            color: "var(--color-text-secondary, var(--color-text))",
            opacity: 0.8,
            paddingTop: 8,
          }}
        >
          <span>
            {article.authorName ? `by ${article.authorName}` : ""}
            {displayDate ? ` · ${displayDate}` : ""}
          </span>
        </div>

        {article.tags && article.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {article.tags.slice(0, 4).map((tag) => (
              <TagBadge key={tag} tag={tag} size="sm" />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
