"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";

type Manual = {
  title: string;
  url: string | null;
  crew: string;
  crewId: string;
  status: string;
  authorId: string;
  author: string;
  lastUpdated: string;
  notes: string;
};

function statusBadge(status: string) {
  const s = status.toLowerCase();
  let bg = "#888";
  let color = "white";

  if (s === "complete" || s === "completed") {
    bg = "#22c55e";
  } else if (s === "draft") {
    bg = "#f97316";
  } else if (s === "needed") {
    bg = "#ef4444";
  } else if (s === "backlog") {
    bg = "#8b5cf6";
  }

  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
    background: bg,
    color,
  };
}

function ManualCard({ manual, index }: { manual: Manual; index: number }) {
  return (
    <Link
      href={`/manuals/${index}`}
      style={{
        display: "block",
        padding: 16,
        background: 'var(--color-surface)',
        borderRadius: 12,
        border: '1px solid var(--color-border)',
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.2s ease",
      }}
      className="manual-card"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {manual.title}
          </h3>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {manual.crew && (
              <Link
                href={`/crew/${manual.crewId}`}
                style={{ marginRight: 12, color: "#2563eb", textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                {manual.crew}
              </Link>
            )}
            {manual.author && manual.authorId && (
              <span>
                by{" "}
                <Link
                  href={`/profile/${manual.authorId}`}
                  style={{ color: "#2563eb", textDecoration: "none" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {manual.author}
                </Link>
              </span>
            )}
            {manual.author && !manual.authorId && <span>by {manual.author}</span>}
          </div>
          {manual.lastUpdated && (
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Updated: {manual.lastUpdated}
            </div>
          )}
        </div>
        {manual.status && (
          <span style={statusBadge(manual.status)}>{manual.status}</span>
        )}
      </div>
    </Link>
  );
}

export default function ManualsPage() {
  const [manuals, setManuals] = useState<Manual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [crewFilter, setCrewFilter] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>(["Complete", "Draft"]);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setStatusDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    async function fetchManuals() {
      try {
        const res = await fetch("/api/manuals");
        if (!res.ok) throw new Error("Failed to fetch manuals");
        const data = await res.json();
        setManuals(data.manuals || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchManuals();
  }, []);

  // Get unique crews and statuses for dropdowns
  const uniqueCrews = [...new Set(manuals.map((m) => m.crew).filter(Boolean))].sort();
  const uniqueStatuses = [...new Set(manuals.map((m) => m.status).filter(Boolean))].sort();

  // Toggle status filter
  const toggleStatusFilter = (status: string) => {
    setStatusFilters((prev) =>
      prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status]
    );
  };

  // Filter manuals
  const filteredManuals = manuals.filter((manual) => {
    const matchesSearch =
      !searchQuery ||
      manual.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      manual.author.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCrew =
      !crewFilter || manual.crew.toLowerCase() === crewFilter.toLowerCase();
    const matchesStatus =
      statusFilters.length === 0 ||
      statusFilters.some((s) => manual.status.toLowerCase() === s.toLowerCase());
    return matchesSearch && matchesCrew && matchesStatus;
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: 'var(--color-page-bg)',
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/"
            style={{
              fontSize: 14,
              color: 'var(--color-text-secondary)',
              textDecoration: "none",
              marginBottom: 8,
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
            }}
          >
            ← Back to Home
          </Link>
          <h1
            style={{
              margin: "8px 0 4px 0",
              fontSize: 28,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            PizzaDAO Manuals
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>
            Operating manuals and documentation for PizzaDAO crews
          </p>
        </div>

        {/* Search and Filters */}
        <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="text"
            placeholder="Search manuals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: 14,
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              outline: "none",
              background: 'var(--color-surface)',
            }}
          />
          <div style={{ display: "flex", gap: 12 }}>
            <select
              value={crewFilter}
              onChange={(e) => setCrewFilter(e.target.value)}
              style={{
                flex: 1,
                padding: "10px 28px 10px 12px",
                fontSize: 14,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                outline: "none",
                background: 'var(--color-surface)',
                cursor: "pointer",
                appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
              }}
            >
              <option value="">All Crews</option>
              {uniqueCrews.map((crew) => (
                <option key={crew} value={crew}>
                  {crew}
                </option>
              ))}
            </select>
            {/* Status multi-select dropdown */}
            <div ref={statusDropdownRef} style={{ flex: 1, position: "relative" }}>
              <button
                type="button"
                onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                style={{
                  width: "100%",
                  padding: "10px 28px 10px 12px",
                  fontSize: 14,
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  outline: "none",
                  background: 'var(--color-surface)',
                  cursor: "pointer",
                  textAlign: "left",
                  appearance: "none",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 12px center",
                }}
              >
                {statusFilters.length === 0
                  ? "All Statuses"
                  : statusFilters.length === uniqueStatuses.length
                  ? "All Statuses"
                  : statusFilters.join(", ")}
              </button>
              {statusDropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    boxShadow: 'var(--shadow-elevated)',
                    zIndex: 10,
                    padding: "8px 0",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "8px 12px",
                      cursor: "pointer",
                      fontSize: 14,
                      borderBottom: '1px solid var(--color-divider)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={statusFilters.length === 0 || statusFilters.length === uniqueStatuses.length}
                      onChange={() => {
                        if (statusFilters.length === uniqueStatuses.length) {
                          setStatusFilters([]);
                        } else {
                          setStatusFilters([...uniqueStatuses]);
                        }
                      }}
                      style={{ marginRight: 8, width: 16, height: 16 }}
                    />
                    All Statuses
                  </label>
                  {uniqueStatuses.map((status) => (
                    <label
                      key={status}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 12px",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={statusFilters.includes(status)}
                        onChange={() => toggleStatusFilter(status)}
                        style={{ marginRight: 8, width: 16, height: 16 }}
                      />
                      {status}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ display: "grid", gap: 12 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  height: 80,
                  background: 'var(--color-surface)',
                  borderRadius: 12,
                  border: '1px solid var(--color-border)',
                  animation: "pulse 1.5s infinite",
                }}
              />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              background: 'var(--color-surface)',
              borderRadius: 12,
              border: '1px solid var(--color-border)',
            }}
          >
            <p style={{ fontSize: 16, color: "#c00", marginBottom: 16 }}>
              {error}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "12px 20px",
                minHeight: 44,
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--color-btn-primary-text)',
                background: 'var(--color-btn-primary-bg)',
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Manuals list */}
        {!loading && !error && (
          <>
            {filteredManuals.length === 0 ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  background: 'var(--color-surface)',
                  borderRadius: 12,
                  border: '1px solid var(--color-border)',
                }}
              >
                <p style={{ fontSize: 16, color: 'var(--color-text-secondary)' }}>
                  {searchQuery || crewFilter || statusFilters.length > 0
                    ? "No manuals match your filters."
                    : "No manuals found."}
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {filteredManuals.map((manual, index) => {
                  // Find original index for the link
                  const originalIndex = manuals.findIndex(
                    (m) => m.title === manual.title && m.crew === manual.crew
                  );
                  return (
                    <ManualCard
                      key={`${manual.title}-${manual.crew}`}
                      manual={manual}
                      index={originalIndex}
                    />
                  );
                })}
              </div>
            )}

            {(searchQuery || crewFilter || (statusFilters.length > 0 && statusFilters.length < uniqueStatuses.length)) &&
              filteredManuals.length > 0 && (
                <p
                  style={{
                    marginTop: 16,
                    textAlign: "center",
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  Showing {filteredManuals.length} of {manuals.length} manuals
                </p>
              )}
          </>
        )}
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

      <style jsx global>{`
        .manual-card:hover {
          border-color: rgba(234, 179, 8, 0.5) !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
      `}</style>
    </div>
  );
}
