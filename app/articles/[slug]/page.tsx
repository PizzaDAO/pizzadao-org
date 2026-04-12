"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArticleRenderer, TagBadge } from "@/app/ui/articles";

interface Article {
  id: number;
  slug: string;
  title: string;
  excerpt?: string | null;
  content: string;
  coverImage?: string | null;
  authorId: string;
  authorName?: string | null;
  authorMemberId?: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  tags: string[];
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function ArticleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/articles/${slug}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error("Article not found");
          throw new Error("Failed to load article");
        }
        const data = await res.json();
        if (!cancelled) setArticle(data.article);

        // Also check if current viewer can edit (author or admin)
        try {
          const meRes = await fetch("/api/me");
          if (meRes.ok) {
            const me = await meRes.json();
            if (me?.discordId && me.discordId === data.article.authorId) {
              if (!cancelled) setCanEdit(true);
            }
          }
        } catch {
          /* non-fatal */
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-page-bg)", padding: "60px 20px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div
            style={{
              height: 32,
              width: "60%",
              background: "var(--color-surface)",
              borderRadius: 6,
              marginBottom: 16,
              animation: "pulse 1.5s infinite",
            }}
          />
          <div
            style={{
              height: 16,
              width: "40%",
              background: "var(--color-surface)",
              borderRadius: 6,
              marginBottom: 32,
              animation: "pulse 1.5s infinite",
            }}
          />
          <div
            style={{
              height: 300,
              background: "var(--color-surface)",
              borderRadius: 12,
              animation: "pulse 1.5s infinite",
            }}
          />
        </div>
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

  if (error || !article) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--color-page-bg)",
          padding: "60px 20px",
        }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ color: "var(--color-text-primary, var(--color-text))" }}>
            {error || "Article not found"}
          </h1>
          <Link
            href="/articles"
            style={{
              display: "inline-block",
              marginTop: 16,
              padding: "10px 18px",
              borderRadius: 8,
              background: "var(--color-btn-primary-bg)",
              color: "var(--color-btn-primary-text)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Back to articles
          </Link>
        </div>
      </div>
    );
  }

  const displayDate = formatDate(article.publishedAt || article.createdAt);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-page-bg)",
        padding: "40px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link
          href="/articles"
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary, var(--color-text))",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
          }}
        >
          ← All articles
        </Link>

        {article.status !== "PUBLISHED" && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "rgba(245, 158, 11, 0.12)",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              color: "#b45309",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            This article is {article.status.toLowerCase()} and is only visible to you and admins.
          </div>
        )}

        <article style={{ marginTop: 20 }}>
          {article.coverImage && (
            <div style={{ marginBottom: 24 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.coverImage}
                alt=""
                style={{
                  width: "100%",
                  maxHeight: 420,
                  objectFit: "cover",
                  borderRadius: 12,
                  border: "1px solid var(--color-border)",
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}

          <h1
            style={{
              margin: "8px 0 12px 0",
              fontSize: 36,
              fontWeight: 800,
              lineHeight: 1.2,
              color: "var(--color-text-primary, var(--color-text))",
            }}
          >
            {article.title}
          </h1>

          {article.excerpt && (
            <p
              style={{
                margin: "0 0 20px 0",
                fontSize: 18,
                lineHeight: 1.5,
                color: "var(--color-text-secondary, var(--color-text))",
                opacity: 0.85,
              }}
            >
              {article.excerpt}
            </p>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 12,
              padding: "12px 0",
              marginBottom: 24,
              borderTop: "1px solid var(--color-border)",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 14,
              color: "var(--color-text-secondary, var(--color-text))",
            }}
          >
            <div>
              {article.authorName && (
                <span>
                  by{" "}
                  <Link
                    href={article.authorMemberId ? `/profile/${article.authorMemberId}` : "#"}
                    style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
                  >
                    {article.authorName}
                  </Link>
                </span>
              )}
              {displayDate && <span> · {displayDate}</span>}
            </div>
            {canEdit && (
              <Link
                href={`/articles/${article.slug}/edit`}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border-strong, var(--color-border))",
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Edit
              </Link>
            )}
          </div>

          <ArticleRenderer content={article.content} />

          {article.tags && article.tags.length > 0 && (
            <div
              style={{
                marginTop: 40,
                paddingTop: 20,
                borderTop: "1px solid var(--color-border)",
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {article.tags.map((tag) => (
                <TagBadge key={tag} tag={tag} href={`/articles?tag=${encodeURIComponent(tag)}`} />
              ))}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
