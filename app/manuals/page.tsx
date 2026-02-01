"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Manual = {
  title: string;
  url: string | null;
  crew: string;
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
        background: "white",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.08)",
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.2s ease",
      }}
      className="manual-card"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#111" }}>
            {manual.title}
          </h3>
          <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
            {manual.crew && <span style={{ marginRight: 12 }}>{manual.crew}</span>}
            {manual.author && <span>by {manual.author}</span>}
          </div>
          {manual.lastUpdated && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#999" }}>
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
  const [statusFilter, setStatusFilter] = useState("");

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

  // Filter manuals
  const filteredManuals = manuals.filter((manual) => {
    const matchesSearch =
      !searchQuery ||
      manual.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      manual.author.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCrew =
      !crewFilter || manual.crew.toLowerCase() === crewFilter.toLowerCase();
    const matchesStatus =
      !statusFilter || manual.status.toLowerCase() === statusFilter.toLowerCase();
    return matchesSearch && matchesCrew && matchesStatus;
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
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
              color: "#666",
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
              color: "#111",
            }}
          >
            PizzaDAO Manuals
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "#666" }}>
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
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 8,
              outline: "none",
              background: "white",
            }}
          />
          <div style={{ display: "flex", gap: 12 }}>
            <select
              value={crewFilter}
              onChange={(e) => setCrewFilter(e.target.value)}
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: 14,
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
                outline: "none",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="">All Crews</option>
              {uniqueCrews.map((crew) => (
                <option key={crew} value={crew}>
                  {crew}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                flex: 1,
                padding: "10px 12px",
                fontSize: 14,
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
                outline: "none",
                background: "white",
                cursor: "pointer",
              }}
            >
              <option value="">All Statuses</option>
              {uniqueStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
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
                  background: "white",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.08)",
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
              background: "white",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.08)",
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
                color: "white",
                background: "#111",
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
                  background: "white",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                <p style={{ fontSize: 16, color: "#666" }}>
                  {searchQuery || crewFilter || statusFilter
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

            {(searchQuery || crewFilter || statusFilter) &&
              filteredManuals.length > 0 && (
                <p
                  style={{
                    marginTop: 16,
                    textAlign: "center",
                    fontSize: 13,
                    color: "#888",
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
