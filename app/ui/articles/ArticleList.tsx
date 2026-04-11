"use client";

import ArticleCard, { type ArticleCardData } from "./ArticleCard";

interface ArticleListProps {
  articles: ArticleCardData[];
  loading?: boolean;
  emptyMessage?: string;
  showStatus?: boolean;
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

export default function ArticleList({
  articles,
  loading = false,
  emptyMessage = "No articles yet.",
  showStatus = false,
}: ArticleListProps) {
  if (loading) {
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
