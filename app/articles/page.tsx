"use client";

// napoletana-41544 — Editorial restyle of the /articles index.
//
// Reframes the list as the front page of a small newspaper:
//   • § ··· The Articles overline
//   • Display-font masthead with a tomato underline-scribble accent
//   • Paper-soft search/filter bar with hand-drawn focus ring
//   • Toolbar buttons reworked as btn-pill primitives
//   • Handwritten margin annotation when a viewer can author
//
// Wiring (fetch, search, tag filter, drafts, view-mode toggle, pagination)
// is unchanged — this is a pure visual rewrite.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArticleList, TagBadge, type ArticleCardData, type ViewMode } from "@/app/ui/articles";

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ArticlesListPage() {
  const [articles, setArticles] = useState<ArticleCardData[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 12, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [canAuthor, setCanAuthor] = useState(false);
  const [drafts, setDrafts] = useState<ArticleCardData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("gallery");

  // Read persisted view mode from localStorage on mount (avoids hydration mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("articles-view-mode");
      if (saved === "gallery" || saved === "list") {
        setViewMode(saved);
      }
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem("articles-view-mode", mode);
    } catch {
      // localStorage may be unavailable
    }
  }

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "12");
      if (activeTag) params.set("tag", activeTag);
      if (search) params.set("search", search);
      const res = await fetch(`/api/articles?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load articles");
      const data = await res.json();
      setArticles(data.articles || []);
      setPagination(data.pagination || { page: 1, limit: 12, total: 0, totalPages: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, activeTag, search]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // Fetch user's drafts (also determines if they can author)
  useEffect(() => {
    let cancelled = false;
    async function fetchDrafts() {
      try {
        const res = await fetch("/api/articles/drafts?all=1");
        if (!cancelled && res.ok) {
          const data = await res.json();
          setCanAuthor(true);
          setDrafts(data.articles || []);
        }
      } catch {
        if (!cancelled) setCanAuthor(false);
      }
    }
    fetchDrafts();
    return () => {
      cancelled = true;
    };
  }, []);

  // Collect unique tags from currently loaded articles for filter chips
  const availableTags = Array.from(new Set(articles.flatMap((a) => a.tags || []))).sort();

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setActiveTag(null);
    setPage(1);
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground px-4 sm:px-5 py-10">
      <div className="mx-auto max-w-[1100px]">
        {/* Back link — quiet upper-left */}
        <Link
          href="/"
          className="overline inline-flex min-h-11 items-center text-foreground/55 hover:text-tomato transition-colors no-underline mb-3"
        >
          <span aria-hidden className="mr-2">←</span> Back to home
        </Link>

        {/* Masthead — overline · display headline · tagline */}
        <header className="relative fade-up mb-8">
          <p className="overline text-tomato">
            <span aria-hidden>§</span>
            <span aria-hidden className="mx-2 opacity-50">···</span>
            The Articles
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div className="min-w-0">
              <h1
                className="font-display font-black tracking-[-0.015em] text-foreground leading-[0.95] m-0"
                style={{
                  fontSize: "clamp(2.6rem, 7vw, 5.2rem)",
                  textWrap: "balance",
                }}
              >
                Dispatches from <span className="text-tomato underline-scribble">the kitchen</span>
              </h1>
              <p
                className="mt-4 max-w-xl text-foreground/70"
                style={{ fontSize: "15px", lineHeight: 1.55 }}
              >
                Stories, updates, and deep dives from PizzaDAO — filed by your friendly neighborhood scribes.
              </p>
            </div>
            {canAuthor && (
              <div className="relative shrink-0">
                <Link
                  href="/articles/new"
                  className="btn-pill-lg"
                  style={{
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  + File a new piece
                </Link>
                <span
                  aria-hidden
                  className="handwritten pointer-events-none absolute -bottom-7 right-1 rotate-[-4deg] text-foreground/55 hidden sm:block"
                  style={{ fontSize: 14 }}
                >
                  press-pass holders only
                </span>
              </div>
            )}
          </div>

          {/* hairline rule under the masthead */}
          <div className="rule-thick mt-8" />
          <div className="rule mt-1" />
        </header>

        {/* Search and filters — paper-soft strip */}
        <div className="paper-soft print-noise mb-8 rounded-[--radius] border border-[hsl(var(--rule-warm)/0.55)] p-4 sm:p-5">
          <div className="relative flex flex-col gap-3">
            <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-2">
              <div className="relative basis-full sm:basis-0 sm:flex-1">
                <span
                  aria-hidden
                  className="overline absolute left-3 top-2 text-foreground/40"
                  style={{ fontSize: 9 }}
                >
                  Search
                </span>
                <input
                  type="text"
                  placeholder="Find an article…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full min-h-11 pt-6 pb-2 px-3 text-base sm:text-sm rounded-[--radius] bg-[hsl(var(--cream))] dark:bg-card text-foreground border border-[hsl(var(--rule-warm)/0.55)] outline-none focus:border-[hsl(var(--tomato))] focus:ring-2 focus:ring-[hsl(var(--tomato)/0.30)] transition-colors"
                />
              </div>
              <button
                type="submit"
                className="btn-pill"
                style={{
                  background: "hsl(var(--foreground))",
                  color: "hsl(var(--background))",
                }}
              >
                Search
              </button>
              {(search || activeTag) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="btn-pill"
                  style={{
                    background: "transparent",
                    color: "hsl(var(--foreground))",
                    border: "1px solid hsl(var(--foreground) / 0.25)",
                  }}
                >
                  Clear
                </button>
              )}
            </form>

            {availableTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="overline text-foreground/45 mr-1">Filed under</span>
                {availableTags.map((tag) => (
                  <TagBadge
                    key={tag}
                    tag={tag}
                    active={activeTag === tag}
                    onClick={() => {
                      setActiveTag(activeTag === tag ? null : tag);
                      setPage(1);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* My Drafts — clipboard pile */}
        {drafts.length > 0 && (
          <section className="mb-10 fade-up">
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <p className="overline text-foreground/45">In the typewriter</p>
                <h2 className="font-display text-2xl md:text-3xl font-black tracking-tight text-foreground mt-1 mb-0">
                  My drafts
                  <span className="ml-2 align-middle inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-[hsl(var(--butter)/0.35)] text-foreground text-[11px] font-bold">
                    {drafts.length}
                  </span>
                </h2>
              </div>
              <span
                aria-hidden
                className="handwritten hidden sm:inline-block rotate-[-3deg] text-foreground/50"
                style={{ fontSize: 14 }}
              >
                not for press yet
              </span>
            </div>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))" }}
            >
              {drafts.map((d) => (
                <Link
                  key={d.slug}
                  href={`/articles/${d.slug}/edit`}
                  className="paper-soft print-noise block p-4 rounded-[--radius] border-2 border-dashed border-[hsl(var(--rule-warm)/0.65)] bg-card text-card-foreground hover:border-[hsl(var(--tomato)/0.60)] transition-colors no-underline"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`overline px-1.5 py-0.5 rounded-md ${
                        d.status === "DRAFT"
                          ? "bg-[hsl(var(--butter)/0.35)] text-[hsl(var(--ink))]"
                          : "bg-[hsl(142_71%_45%/0.18)] text-[hsl(142_71%_25%)] dark:text-[hsl(142_71%_60%)]"
                      }`}
                      style={{ fontSize: 10 }}
                    >
                      {d.status || "DRAFT"}
                    </span>
                  </div>
                  <div className="font-display font-black text-lg leading-tight text-foreground tracking-tight">
                    {d.title || "(untitled)"}
                  </div>
                  {d.excerpt && (
                    <div
                      className="text-sm text-muted-foreground mt-1.5 overflow-hidden"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        textWrap: "pretty",
                      }}
                    >
                      {d.excerpt}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="p-4 mb-4 rounded-[--radius] text-sm font-semibold border bg-[hsl(var(--destructive)/0.10)] border-[hsl(var(--destructive)/0.30)] text-[hsl(var(--destructive))]"
          >
            {error}
          </div>
        )}

        {/* Section label + view toggle */}
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <p className="overline text-foreground/45">The latest</p>
            <h2 className="font-display text-xl md:text-2xl font-black tracking-tight text-foreground mt-1 mb-0">
              {search || activeTag ? "Filtered dispatches" : "All dispatches"}
            </h2>
          </div>
          <div className="inline-flex rounded-full border border-[hsl(var(--foreground)/0.20)] overflow-hidden bg-card">
            <button
              type="button"
              onClick={() => handleViewModeChange("gallery")}
              aria-label="Gallery view"
              title="Gallery view"
              className={`flex items-center justify-center w-11 h-11 cursor-pointer transition-colors ${
                viewMode === "gallery"
                  ? "bg-foreground text-background"
                  : "text-foreground/60 hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
                <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" />
                <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
                <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("list")}
              aria-label="List view"
              title="List view"
              className={`flex items-center justify-center w-11 h-11 cursor-pointer border-l border-[hsl(var(--foreground)/0.20)] transition-colors ${
                viewMode === "list"
                  ? "bg-foreground text-background"
                  : "text-foreground/60 hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <rect x="1" y="1" width="14" height="3" rx="1" fill="currentColor" />
                <rect x="1" y="6.5" width="14" height="3" rx="1" fill="currentColor" />
                <rect x="1" y="12" width="14" height="3" rx="1" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>

        <ArticleList
          articles={articles}
          loading={loading}
          viewMode={viewMode}
          emptyMessage={
            search || activeTag ? "No dispatches match your filters." : "No articles in print yet."
          }
        />

        {/* Pagination */}
        {!loading && pagination.totalPages > 1 && (
          <div className="mt-10 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="btn-pill"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.25)",
              }}
            >
              ← Prev
            </button>
            <span className="overline text-foreground/55">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
              disabled={page >= pagination.totalPages}
              className="btn-pill"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.25)",
              }}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
