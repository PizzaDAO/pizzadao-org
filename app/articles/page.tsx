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
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-page-bg)",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/"
            style={{
              fontSize: 14,
              color: "var(--color-text-secondary, var(--color-text))",
              textDecoration: "none",
              marginBottom: 8,
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
            }}
          >
            ← Back to Home
          </Link>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1
                style={{
                  margin: "8px 0 4px 0",
                  fontSize: 32,
                  fontWeight: 800,
                  color: "var(--color-text-primary, var(--color-text))",
                }}
              >
                Articles
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  color: "var(--color-text-secondary, var(--color-text))",
                  opacity: 0.8,
                }}
              >
                Stories, updates, and deep dives from PizzaDAO
              </p>
            </div>
            {canAuthor && (
              <Link
                href="/articles/new"
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  background: "var(--color-btn-primary-bg)",
                  color: "var(--color-btn-primary-text)",
                  border: "1px solid var(--color-btn-primary-border)",
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                + New article
              </Link>
            )}
          </div>
        </div>

        {/* Search and filters */}
        <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="Search articles..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{
                flex: 1,
                padding: "12px 16px",
                fontSize: 14,
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                outline: "none",
                background: "var(--color-surface)",
                color: "var(--color-text)",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 8,
                border: "1px solid var(--color-border-strong, var(--color-border))",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                cursor: "pointer",
              }}
            >
              Search
            </button>
            {(search || activeTag) && (
              <button
                type="button"
                onClick={clearFilters}
                style={{
                  padding: "10px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text)",
                  cursor: "pointer",
                }}
              >
                Clear
              </button>
            )}
          </form>

          {availableTags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary, var(--color-text))",
                  opacity: 0.7,
                  alignSelf: "center",
                  marginRight: 4,
                }}
              >
                Tags:
              </span>
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
          <div style={{ marginBottom: 32 }}>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "var(--color-text-primary, var(--color-text))",
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              My Drafts
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "rgba(234, 179, 8, 0.15)",
                  color: "#b45309",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                {drafts.length}
              </span>
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: 16,
              }}
            >
              {drafts.map((d) => (
                <Link
                  key={d.slug}
                  href={`/articles/${d.slug}/edit`}
                  style={{
                    display: "block",
                    padding: 16,
                    borderRadius: 12,
                    border: "1px dashed var(--color-border)",
                    background: "var(--color-surface)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: d.status === "DRAFT"
                          ? "rgba(234, 179, 8, 0.15)"
                          : "rgba(34, 197, 94, 0.15)",
                        color: d.status === "DRAFT" ? "#b45309" : "#15803d",
                        textTransform: "uppercase",
                      }}
                    >
                      {d.status || "DRAFT"}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{d.title}</div>
                  {d.excerpt && (
                    <div
                      style={{
                        fontSize: 13,
                        opacity: 0.6,
                        marginTop: 4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
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
            style={{
              padding: 16,
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#c00",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {/* View toggle */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => handleViewModeChange("gallery")}
              title="Gallery view"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 32,
                border: "none",
                cursor: "pointer",
                background: viewMode === "gallery"
                  ? "var(--color-btn-primary-bg)"
                  : "var(--color-surface)",
                color: viewMode === "gallery"
                  ? "var(--color-btn-primary-text)"
                  : "var(--color-text-secondary, var(--color-text))",
                transition: "all 0.15s ease",
              }}
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
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 32,
                border: "none",
                borderLeft: "1px solid var(--color-border)",
                cursor: "pointer",
                background: viewMode === "list"
                  ? "var(--color-btn-primary-bg)"
                  : "var(--color-surface)",
                color: viewMode === "list"
                  ? "var(--color-btn-primary-text)"
                  : "var(--color-text-secondary, var(--color-text))",
                transition: "all 0.15s ease",
              }}
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
          <div
            style={{
              marginTop: 32,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 12,
            }}
          >
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              style={{
                padding: "8px 14px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                cursor: page <= 1 ? "not-allowed" : "pointer",
                opacity: page <= 1 ? 0.5 : 1,
              }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: 14, color: "var(--color-text-secondary, var(--color-text))" }}>
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
              disabled={page >= pagination.totalPages}
              style={{
                padding: "8px 14px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                cursor: page >= pagination.totalPages ? "not-allowed" : "pointer",
                opacity: page >= pagination.totalPages ? 0.5 : 1,
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
