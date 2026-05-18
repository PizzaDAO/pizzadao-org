"use client";

import { useEffect, useState } from "react";
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

export default function ArticleDetailClient({ slug }: { slug: string }) {
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
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[760px]">
          <div
            className="h-8 w-3/5 mb-4 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
            style={{ animation: "pulse 1.5s infinite" }}
          />
          <div
            className="h-4 w-2/5 mb-8 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
            style={{ animation: "pulse 1.5s infinite" }}
          />
          <div
            className="h-72 rounded-[--radius] bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
            style={{ animation: "pulse 1.5s infinite" }}
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
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[760px] text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">
            {error || "Article not found"}
          </h1>
          <Link
            href="/articles"
            className="inline-block mt-4 px-5 py-2.5 rounded-[--radius] bg-primary text-primary-foreground font-display font-semibold hover:opacity-90 transition-opacity no-underline"
          >
            Back to articles
          </Link>
        </div>
      </div>
    );
  }

  const displayDate = formatDate(article.publishedAt || article.createdAt);

  return (
    <div className="min-h-screen bg-background text-foreground px-5 pt-10 pb-20">
      <div className="mx-auto max-w-[760px]">
        <Link
          href="/articles"
          className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground transition-colors no-underline"
        >
          ← All articles
        </Link>

        {article.status !== "PUBLISHED" && (
          <div className="mt-3 px-3 py-2 rounded-[--radius] text-sm font-semibold bg-[hsl(var(--butter)/0.20)] border border-[hsl(var(--butter)/0.50)] text-[hsl(var(--ink))]">
            This article is {article.status.toLowerCase()} and is only visible to you and admins.
          </div>
        )}

        <article className="mt-5">
          {article.coverImage && (
            <div className="mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.coverImage}
                alt=""
                className="w-full max-h-[420px] object-cover rounded-[--radius] border border-[hsl(var(--rule)/0.22)]"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}

          <h1
            className="font-display text-4xl md:text-5xl font-extrabold leading-[1.1] tracking-tight text-foreground my-3"
            style={{ textWrap: "balance" }}
          >
            {article.title}
          </h1>

          {article.excerpt && (
            <p
              className="text-lg leading-relaxed text-muted-foreground mt-0 mb-5"
              style={{ textWrap: "pretty" }}
            >
              {article.excerpt}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 py-3 mb-6 border-t border-b border-[hsl(var(--rule)/0.12)] text-sm text-muted-foreground">
            <div>
              {article.authorName && (
                <span>
                  by{" "}
                  <Link
                    href={article.authorMemberId ? `/profile/${article.authorMemberId}` : "#"}
                    className="font-semibold text-[hsl(var(--tomato))] hover:text-[hsl(var(--tomato-deep))] transition-colors no-underline"
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
                className="px-3 py-1.5 rounded-md border border-[hsl(var(--rule)/0.22)] bg-card text-foreground text-xs font-semibold hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] transition-colors no-underline"
              >
                Edit
              </Link>
            )}
          </div>

          <ArticleRenderer content={article.content} />

          {article.tags && article.tags.length > 0 && (
            <div className="mt-10 pt-5 border-t border-[hsl(var(--rule)/0.12)] flex flex-wrap gap-2">
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
