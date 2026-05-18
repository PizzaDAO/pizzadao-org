"use client";

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
    <div className="min-h-screen bg-background text-foreground px-5 py-10">
      <div className="mx-auto max-w-[1100px]">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            ← Back to Home
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1
                className="font-display text-4xl md:text-5xl font-extrabold leading-tight tracking-tight text-foreground my-1"
                style={{ textWrap: "balance" }}
              >
                Articles
              </h1>
              <p className="m-0 text-base text-muted-foreground">
                Stories, updates, and deep dives from PizzaDAO
              </p>
            </div>
            {canAuthor && (
              <Link
                href="/articles/new"
                className="inline-flex items-center font-display font-bold text-sm px-4 py-2.5 rounded-[--radius] bg-tomato text-cream border border-tomato hover:bg-[hsl(var(--tomato-deep))] hover:border-[hsl(var(--tomato-deep))] transition-colors"
              >
                + New article
              </Link>
            )}
          </div>
        </div>

        {/* Search and filters */}
        <div className="mb-6 flex flex-col gap-3">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Search articles..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="flex-1 px-4 py-3 text-sm rounded-[--radius] bg-[hsl(var(--cream))] dark:bg-card text-foreground border border-[hsl(var(--rule)/0.22)] outline-none focus:border-[hsl(var(--tomato))] focus:ring-2 focus:ring-[hsl(var(--tomato)/0.30)] transition-colors"
            />
            <button
              type="submit"
              className="px-5 py-2.5 text-sm font-semibold rounded-[--radius] bg-secondary text-secondary-foreground border border-[hsl(var(--rule)/0.22)] hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] transition-colors cursor-pointer"
            >
              Search
            </button>
            {(search || activeTag) && (
              <button
                type="button"
                onClick={clearFilters}
                className="px-4 py-2.5 text-sm font-semibold rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-transparent text-foreground hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </form>

          {availableTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="self-center text-xs text-muted-foreground mr-1">Tags:</span>
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

        {/* My Drafts section */}
        {drafts.length > 0 && (
          <div className="mb-8">
            <h2 className="font-display text-2xl font-bold text-foreground mb-3 flex items-center gap-2">
              My Drafts
              <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md bg-[hsl(var(--butter)/0.30)] text-[hsl(var(--ink))]">
                {drafts.length}
              </span>
            </h2>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}
            >
              {drafts.map((d) => (
                <Link
                  key={d.slug}
                  href={`/articles/${d.slug}/edit`}
                  className="block p-4 rounded-[--radius] border border-dashed border-[hsl(var(--rule)/0.30)] bg-card text-card-foreground hover:bg-[hsl(var(--ink)/0.04)] dark:hover:bg-[hsl(var(--cream)/0.04)] hover:border-[hsl(var(--tomato)/0.50)] transition-colors no-underline"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${
                        d.status === "DRAFT"
                          ? "bg-[hsl(var(--butter)/0.30)] text-[hsl(var(--ink))]"
                          : "bg-[hsl(142_71%_45%/0.18)] text-[hsl(142_71%_25%)] dark:text-[hsl(142_71%_60%)]"
                      }`}
                    >
                      {d.status || "DRAFT"}
                    </span>
                  </div>
                  <div className="font-display font-bold text-base text-foreground">{d.title}</div>
                  {d.excerpt && (
                    <div
                      className="text-sm text-muted-foreground mt-1 overflow-hidden"
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {d.excerpt}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="p-4 mb-4 rounded-[--radius] text-sm font-semibold border bg-[hsl(var(--destructive)/0.10)] border-[hsl(var(--destructive)/0.30)] text-[hsl(var(--destructive))]"
          >
            {error}
          </div>
        )}

        {/* View toggle */}
        <div className="mb-4 flex justify-end">
          <div className="inline-flex rounded-[--radius] border border-[hsl(var(--rule)/0.22)] overflow-hidden">
            <button
              type="button"
              onClick={() => handleViewModeChange("gallery")}
              title="Gallery view"
              className={`flex items-center justify-center w-9 h-8 cursor-pointer transition-colors ${
                viewMode === "gallery"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
                <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" />
                <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" />
                <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("list")}
              title="List view"
              className={`flex items-center justify-center w-9 h-8 cursor-pointer border-l border-[hsl(var(--rule)/0.22)] transition-colors ${
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)]"
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
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
            search || activeTag ? "No articles match your filters." : "No articles published yet."
          }
        />

        {/* Pagination */}
        {!loading && pagination.totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-3.5 py-2 text-sm rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-card text-foreground hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              ← Prev
            </button>
            <span className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
              disabled={page >= pagination.totalPages}
              className="px-3.5 py-2 text-sm rounded-[--radius] border border-[hsl(var(--rule)/0.22)] bg-card text-foreground hover:bg-[hsl(var(--ink)/0.06)] dark:hover:bg-[hsl(var(--cream)/0.06)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
