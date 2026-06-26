"use client";

// napoletana-41544 — Editorial restyle of the article detail page.
//
// Treats the page as a newspaper feature: § ··· The Articles overline,
// large display headline with clamp() sizing, byline + dateline in
// uppercase micro-type, optional cover photo framed as a press print, and
// a paper-soft footer with reactions + comments.
//
// All data shapes, API endpoints, and component contracts (ArticleRenderer,
// ArticleReactions, CommentList, TagBadge) are untouched.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArticleRenderer, TagBadge, CommentList, ArticleReactions } from "@/app/ui/articles";

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
  const [currentUserDiscordId, setCurrentUserDiscordId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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

        // Look up the current viewer's discordId and admin flag in parallel.
        // Both are non-fatal; comments still render for logged-out viewers.
        try {
          const [meRes, adminRes] = await Promise.all([
            fetch("/api/me"),
            fetch("/api/me/admin"),
          ]);
          if (meRes.ok) {
            const me = await meRes.json();
            if (me?.discordId && !cancelled) {
              setCurrentUserDiscordId(me.discordId);
              if (me.discordId === data.article.authorId) {
                setCanEdit(true);
              }
            }
          }
          if (adminRes.ok) {
            const adminData = await adminRes.json();
            if (!cancelled && adminData?.isAdmin) {
              setIsAdmin(true);
              // Admins can also edit articles
              setCanEdit(true);
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
            className="h-3 w-24 mb-6 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
            style={{ animation: "pulse 1.5s infinite" }}
          />
          <div
            className="h-10 w-4/5 mb-3 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
            style={{ animation: "pulse 1.5s infinite" }}
          />
          <div
            className="h-10 w-2/3 mb-6 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
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
            100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="min-h-screen bg-background text-foreground px-5 py-14">
        <div className="mx-auto max-w-[760px] text-center fade-up">
          <p className="overline text-tomato">Stop the presses</p>
          <h1
            className="font-display font-black tracking-[-0.015em] text-foreground mt-3"
            style={{
              fontSize: "clamp(2rem, 5vw, 3.4rem)",
              lineHeight: 1,
              textWrap: "balance",
            }}
          >
            {error || "Article not found"}
          </h1>
          <Link
            href="/articles"
            className="btn-pill-lg mt-6"
            style={{
              background: "hsl(var(--tomato))",
              color: "hsl(var(--cream))",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            Back to the desk
          </Link>
        </div>
      </div>
    );
  }

  const displayDate = formatDate(article.publishedAt || article.createdAt);

  return (
    <div className="relative min-h-screen bg-background text-foreground px-5 pt-10 pb-20">
      <div className="mx-auto max-w-[760px]">
        {/* Quiet back link */}
        <Link
          href="/articles"
          className="overline inline-flex min-h-11 items-center text-foreground/55 hover:text-tomato transition-colors no-underline"
        >
          <span aria-hidden className="mr-2">←</span> All dispatches
        </Link>

        {/* Draft / archived banner — handwritten margin note style */}
        {article.status !== "PUBLISHED" && (
          <div
            className="paper-soft mt-4 px-4 py-3 rounded-[--radius] border border-[hsl(var(--butter)/0.55)] bg-[hsl(var(--butter)/0.15)] text-foreground"
            style={{ fontSize: 14 }}
          >
            <span className="overline text-foreground/55 mr-2">Not for press</span>
            <span>
              This article is <strong className="font-bold">{article.status.toLowerCase()}</strong> — only you and admins can see it.
            </span>
          </div>
        )}

        {/* ─── MASTHEAD ─────────────────────────────────────────── */}
        <article className="mt-6 fade-up">
          <p className="overline text-tomato">
            <span aria-hidden>§</span>
            <span aria-hidden className="mx-2 opacity-50">···</span>
            The Articles
            {article.tags && article.tags[0] && (
              <span className="ml-2 text-foreground/55">/ {article.tags[0]}</span>
            )}
          </p>

          <h1
            className="font-display font-black tracking-[-0.02em] text-foreground mt-4 mb-0 leading-[0.95]"
            style={{
              fontSize: "clamp(2.4rem, 6.5vw, 4.6rem)",
              textWrap: "balance",
            }}
          >
            {article.title}
          </h1>

          {article.excerpt && (
            <p
              className="mt-5 mb-0 text-foreground/75"
              style={{
                fontSize: "clamp(1.05rem, 1.7vw, 1.25rem)",
                lineHeight: 1.5,
                textWrap: "pretty",
              }}
            >
              {article.excerpt}
            </p>
          )}

          {/* Byline + dateline — uppercase micro-type between hairlines */}
          <div className="rule-thick mt-7" />
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p className="overline m-0 text-foreground/65">
              {article.authorName ? (
                <>
                  By{" "}
                  <Link
                    href={article.authorMemberId ? `/profile/${article.authorMemberId}` : "#"}
                    className="text-tomato hover:text-[hsl(var(--tomato-deep))] transition-colors no-underline"
                  >
                    {article.authorName}
                  </Link>
                </>
              ) : (
                "By a friend of the family"
              )}
              {displayDate && (
                <>
                  <span aria-hidden className="mx-2 opacity-50">···</span>
                  {displayDate}
                </>
              )}
            </p>
            {canEdit && (
              <Link
                href={`/articles/${article.slug}/edit`}
                className="overline inline-flex items-center justify-center min-h-9 px-3 py-1.5 rounded-full border border-[hsl(var(--foreground)/0.20)] bg-card text-foreground hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] transition-colors no-underline"
              >
                Edit
              </Link>
            )}
          </div>
          <div className="rule" />

          {/* Cover photo — framed as a press print */}
          {article.coverImage && (
            <figure className="relative mt-7 mb-2">
              <div
                className="paper-soft relative overflow-hidden rounded-[--radius] border border-[hsl(var(--rule-warm)/0.65)]"
                style={{ boxShadow: "var(--shadow-lifted)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={article.coverImage}
                  alt=""
                  className="w-full max-h-[460px] object-cover block"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <span
                aria-hidden
                className="handwritten pointer-events-none absolute -bottom-6 right-2 rotate-[-3deg] text-foreground/50 hidden sm:block"
                style={{ fontSize: 14 }}
              >
                cover photograph
              </span>
            </figure>
          )}

          {/* ─── BODY ────────────────────────────────────────────── */}
          <div className="mt-10">
            <ArticleRenderer content={article.content} />
          </div>

          {/* Tags — filed under */}
          {article.tags && article.tags.length > 0 && (
            <div className="mt-12 pt-5 border-t border-[hsl(var(--rule)/0.18)]">
              <p className="overline text-foreground/45 mb-2">Filed under</p>
              <div className="flex flex-wrap gap-2">
                {article.tags.map((tag) => (
                  <TagBadge key={tag} tag={tag} href={`/articles?tag=${encodeURIComponent(tag)}`} />
                ))}
              </div>
            </div>
          )}

          {/* Editorial sign-off — finis */}
          <div className="mt-12 flex items-center justify-center gap-3" aria-hidden>
            <span className="rule-warm flex-1 max-w-[80px]" />
            <span className="overline text-foreground/40">— 30 —</span>
            <span className="rule-warm flex-1 max-w-[80px]" />
          </div>
        </article>

        {article.status === "PUBLISHED" && (
          <>
            <ArticleReactions
              slug={article.slug}
              currentUserDiscordId={currentUserDiscordId}
            />
            <CommentList
              slug={article.slug}
              currentUserDiscordId={currentUserDiscordId}
              isAdmin={isAdmin}
            />
          </>
        )}
      </div>
    </div>
  );
}
