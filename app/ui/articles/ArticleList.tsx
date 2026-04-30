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
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        overflow: "hidden",
        animation: "pulse 1.5s infinite",
      }}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          background: "var(--color-surface-hover, rgba(0,0,0,0.08))",
        }}
      />
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            height: 18,
            background: "var(--color-surface-hover, rgba(0,0,0,0.08))",
            borderRadius: 4,
            width: "80%",
          }}
        />
        <div
          style={{
            height: 14,
            background: "var(--color-surface-hover, rgba(0,0,0,0.08))",
            borderRadius: 4,
            width: "100%",
          }}
        />
        <div
          style={{
            height: 14,
            background: "var(--color-surface-hover, rgba(0,0,0,0.08))",
            borderRadius: 4,
            width: "60%",
          }}
        />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 16px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        animation: "pulse 1.5s infinite",
      }}
    >
      <div
        style={{
          width: 80,
          height: 56,
          borderRadius: 6,
          background: "var(--color-surface-hover, rgba(0,0,0,0.08))",
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            height: 16,
            background: "var(--color-surface-hover, rgba(0,0,0,0.08))",
            borderRadius: 4,
            width: "60%",
          }}
        />
        <div
          style={{
            height: 12,
            background: "var(--color-surface-hover, rgba(0,0,0,0.08))",
            borderRadius: 4,
            width: "40%",
          }}
        />
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
      className="article-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 16px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.2s ease",
      }}
    >
      {imageUrl && (
        <div
          style={{
            width: 80,
            height: 56,
            borderRadius: 6,
            overflow: "hidden",
            flexShrink: 0,
            background: "var(--color-surface-hover, rgba(0,0,0,0.04))",
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
              (e.target as HTMLImageElement).parentElement!.style.display = "none";
            }}
          />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 700,
            color: "var(--color-text-primary, var(--color-text))",
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {article.title}
        </h3>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
            fontSize: 12,
            color: "var(--color-text-secondary, var(--color-text))",
            opacity: 0.8,
          }}
        >
          <span>
            {article.authorName ? `by ${article.authorName}` : ""}
            {displayDate ? ` · ${displayDate}` : ""}
          </span>
        </div>
        {article.excerpt && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              lineHeight: 1.4,
              color: "var(--color-text-secondary, var(--color-text))",
              opacity: 0.7,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {article.excerpt}
          </p>
        )}
      </div>
      {article.tags && article.tags.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            flexShrink: 0,
            maxWidth: 200,
          }}
        >
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
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 20,
        }}
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
      <div
        style={{
          padding: 40,
          textAlign: "center",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          color: "var(--color-text-secondary, var(--color-text))",
        }}
      >
        <p style={{ fontSize: 16, margin: 0 }}>{emptyMessage}</p>
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {articles.map((article) => (
          <ArticleListRow key={article.id} article={article} />
        ))}

        <style jsx global>{`
          .article-card:hover {
            border-color: rgba(234, 179, 8, 0.5) !important;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
            transform: translateY(-1px);
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 20,
      }}
    >
      {articles.map((article) => (
        <ArticleCard key={article.id} article={article} showStatus={showStatus} />
      ))}

      <style jsx global>{`
        .article-card:hover {
          border-color: rgba(234, 179, 8, 0.5) !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
          transform: translateY(-2px);
        }
      `}</style>
    </div>
  );
}
