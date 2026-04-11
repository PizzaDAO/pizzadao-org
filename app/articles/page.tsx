"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArticleList, TagBadge, type ArticleCardData } from "@/app/ui/articles";

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

  // Check if the current user has draft access (author role). Used to show "New article" button.
  useEffect(() => {
    let cancelled = false;
    async function checkAuthor() {
      try {
        const res = await fetch("/api/articles/drafts");
        if (!cancelled) setCanAuthor(res.ok);
      } catch {
        if (!cancelled) setCanAuthor(false);
      }
    }
    checkAuthor();
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

        <ArticleList
          articles={articles}
          loading={loading}
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
