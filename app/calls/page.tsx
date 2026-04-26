"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface CallEntry {
  date: string;
  crewId: string;
  crewLabel: string;
  attendeeCount: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface CrewFilterCount {
  id: string;
  label: string;
  count: number;
}

interface Attendee {
  discordId: string;
  displayName: string;
  memberId: string | null;
}

interface CallDetail {
  crewId: string;
  crewLabel: string;
  date: string;
  attendeeCount: number;
  attendees: Attendee[];
}

const PAGE_LIMIT = 20;

export default function CallsPage() {
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    total: 0,
    totalPages: 1,
  });
  const [crewCounts, setCrewCounts] = useState<CrewFilterCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [crewFilter, setCrewFilter] = useState<string[]>([]);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);

  // Expanded call detail
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_LIMIT));
      if (crewFilter.length) params.set("crew", crewFilter.join(","));
      if (sort !== "newest") params.set("sort", sort);

      const res = await fetch(`/api/calls?${params.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to load calls");
      }
      const data = await res.json();
      setCalls(data.calls || []);
      setPagination(
        data.pagination || { page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 1 }
      );
      setCrewCounts(data.filters?.crews || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, crewFilter, sort]);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  function toggleCrew(id: string) {
    setCrewFilter((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
    setPage(1);
    setExpandedKey(null);
  }

  function clearFilters() {
    setCrewFilter([]);
    setSort("newest");
    setPage(1);
    setExpandedKey(null);
  }

  const hasActiveFilters = crewFilter.length > 0 || sort !== "newest";

  async function toggleExpand(crewId: string, date: string) {
    const key = `${crewId}:${date}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      setDetail(null);
      return;
    }
    setExpandedKey(key);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/calls/${crewId}/${date}`);
      if (!res.ok) throw new Error("Failed to load attendees");
      const data: CallDetail = await res.json();
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-page-bg)",
        color: "var(--color-text)",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/"
            style={{
              fontSize: 14,
              color: "var(--color-text-secondary, var(--color-text))",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
            }}
          >
            &larr; Back to Home
          </Link>
          <h1
            style={{
              margin: "8px 0 4px 0",
              fontSize: 32,
              fontWeight: 800,
              color: "var(--color-text-primary, var(--color-text))",
            }}
          >
            Call History
          </h1>
          {!loading && !error && (
            <p
              style={{
                margin: 0,
                fontSize: 15,
                color: "var(--color-text-secondary, var(--color-text))",
                opacity: 0.8,
              }}
            >
              {pagination.total} crew call{pagination.total === 1 ? "" : "s"} recorded
            </p>
          )}
        </div>

        {/* Crew filter chips */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>
              Crews:
            </span>
            <FilterChip
              label="All"
              active={crewFilter.length === 0}
              onClick={() => {
                setCrewFilter([]);
                setPage(1);
                setExpandedKey(null);
              }}
            />
            {crewCounts.map((c) => (
              <FilterChip
                key={c.id}
                label={`${c.label} (${c.count})`}
                active={crewFilter.includes(c.id)}
                onClick={() => toggleCrew(c.id)}
              />
            ))}
          </div>
        </div>

        {/* Count + Sort */}
        {!loading && !error && (
          <div
            style={{
              fontSize: 13,
              opacity: 0.7,
              marginBottom: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>
              {pagination.total === 0
                ? "No calls match your filters"
                : `Showing ${calls.length} of ${pagination.total} call${
                    pagination.total === 1 ? "" : "s"
                  }`}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    background: "transparent",
                    color: "var(--color-text)",
                    cursor: "pointer",
                  }}
                >
                  Clear filters
                </button>
              )}
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                style={{
                  padding: "6px 10px",
                  fontSize: 13,
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  background: "var(--color-surface)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>
        )}

        {/* Error */}
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

        {/* Loading skeleton */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                style={{
                  padding: 16,
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  height: 56,
                  opacity: 0.5,
                  animation: "pulse 1.6s ease-in-out infinite",
                }}
              />
            ))}
            <style jsx>{`
              @keyframes pulse {
                0%,
                100% {
                  opacity: 0.4;
                }
                50% {
                  opacity: 0.8;
                }
              }
            `}</style>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && calls.length === 0 && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              background: "var(--color-surface)",
            }}
          >
            <p style={{ margin: 0, fontSize: 16, opacity: 0.7 }}>
              No calls found.
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                style={{
                  marginTop: 16,
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
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Call list */}
        {!loading && !error && calls.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {calls.map((call) => {
              const key = `${call.crewId}:${call.date}`;
              const isExpanded = expandedKey === key;
              return (
                <div key={key}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(call.crewId, call.date)}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderRadius: isExpanded ? "10px 10px 0 0" : 10,
                      border: "1px solid var(--color-border)",
                      borderBottom: isExpanded
                        ? "1px solid var(--color-border)"
                        : "1px solid var(--color-border)",
                      background: isExpanded
                        ? "var(--color-surface)"
                        : "var(--color-surface)",
                      color: "var(--color-text)",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      transition: "background 0.15s",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        minWidth: 120,
                        color: "var(--color-text-primary, var(--color-text))",
                      }}
                    >
                      {formatDate(call.date)}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background: "rgba(91,156,255,0.12)",
                        color: "#5b9cff",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {call.crewLabel}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        opacity: 0.6,
                        marginLeft: "auto",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {call.attendeeCount} attendee{call.attendeeCount === 1 ? "" : "s"}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        opacity: 0.4,
                        transition: "transform 0.2s",
                        transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    >
                      &#9660;
                    </span>
                  </button>

                  {/* Expanded attendee list */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: "12px 16px",
                        borderRadius: "0 0 10px 10px",
                        border: "1px solid var(--color-border)",
                        borderTop: "none",
                        background: "var(--color-surface)",
                      }}
                    >
                      {detailLoading && (
                        <p style={{ margin: 0, fontSize: 13, opacity: 0.6 }}>
                          Loading attendees...
                        </p>
                      )}
                      {!detailLoading && !detail && (
                        <p style={{ margin: 0, fontSize: 13, opacity: 0.6 }}>
                          Failed to load attendees.
                        </p>
                      )}
                      {!detailLoading && detail && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          {detail.attendees.map((a) =>
                            a.memberId ? (
                              <Link
                                key={a.discordId}
                                href={`/profile/${a.memberId}`}
                                style={{
                                  fontSize: 13,
                                  padding: "4px 10px",
                                  borderRadius: 8,
                                  background: "rgba(91,156,255,0.08)",
                                  color: "#5b9cff",
                                  textDecoration: "none",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {a.displayName}
                              </Link>
                            ) : (
                              <span
                                key={a.discordId}
                                style={{
                                  fontSize: 13,
                                  padding: "4px 10px",
                                  borderRadius: 8,
                                  background:
                                    "var(--color-bg-secondary, rgba(0,0,0,0.04))",
                                  color: "var(--color-text)",
                                  opacity: 0.7,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {a.displayName}
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

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
              onClick={() => {
                setPage(Math.max(1, page - 1));
                setExpandedKey(null);
              }}
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
              &larr; Prev
            </button>
            <span
              style={{
                fontSize: 14,
                color: "var(--color-text-secondary, var(--color-text))",
              }}
            >
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              onClick={() => {
                setPage(Math.min(pagination.totalPages, page + 1));
                setExpandedKey(null);
              }}
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
              Next &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontSize: 13,
        fontWeight: 600,
        borderRadius: 999,
        border: active
          ? "1px solid var(--color-btn-primary-border, #ff4d4d)"
          : "1px solid var(--color-border)",
        background: active
          ? "var(--color-btn-primary-bg, rgba(255,77,77,0.15))"
          : "var(--color-surface)",
        color: active
          ? "var(--color-btn-primary-text, #ff4d4d)"
          : "var(--color-text)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
