"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CREWS, TURTLES } from "@/app/ui/constants";

interface PublicMember {
  id: string;
  name: string;
  city: string;
  crews: string[];
  turtles: string[];
  orgs: string;
  skills: string;
  status: string;
  totalCalls: number;
  lastCallDate: string | null;
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

interface TurtleFilterCount {
  id: string;
  count: number;
}

interface MembersResponse {
  members: PublicMember[];
  pagination: Pagination;
  filters: {
    crews: CrewFilterCount[];
    turtles: TurtleFilterCount[];
  };
}

const PAGE_LIMIT = 24;

export default function CrewMembersPage() {
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: PAGE_LIMIT,
    total: 0,
    totalPages: 1,
  });
  const [crewCounts, setCrewCounts] = useState<CrewFilterCount[]>([]);
  const [turtleCounts, setTurtleCounts] = useState<TurtleFilterCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [crewFilter, setCrewFilter] = useState<string | null>(null);
  const [turtleFilter, setTurtleFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("name_asc");
  const [pfpUrls, setPfpUrls] = useState<Record<string, string>>({});

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(PAGE_LIMIT));
      if (search) params.set("search", search);
      if (crewFilter) params.set("crew", crewFilter);
      if (turtleFilter) params.set("turtle", turtleFilter);
      if (sort !== "name_asc") params.set("sort", sort);

      const res = await fetch(`/api/crew/members?${params.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to load members");
      }
      const data: MembersResponse = await res.json();
      setMembers(data.members || []);
      setPagination(
        data.pagination || { page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 1 }
      );
      setCrewCounts(data.filters?.crews || []);
      setTurtleCounts(data.filters?.turtles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, search, crewFilter, turtleFilter, sort]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Debounce search input
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput.trim() !== search) {
        setSearch(searchInput.trim());
        setPage(1);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput, search]);

  // Fetch profile pictures for visible members in batches of 10
  useEffect(() => {
    if (!members.length) {
      setPfpUrls({});
      return;
    }
    let cancelled = false;

    async function fetchPfps() {
      const urls: Record<string, string> = {};
      const batchSize = 10;
      for (let i = 0; i < members.length; i += batchSize) {
        if (cancelled) return;
        const batch = members.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (m) => {
            if (!m.id) return null;
            const res = await fetch(`/api/pfp/${m.id}`);
            if (!res.ok) return null;
            const json = await res.json();
            return { id: m.id, url: json.url as string | undefined };
          })
        );
        for (const result of results) {
          if (result.status === "fulfilled" && result.value?.url) {
            urls[result.value.id] = result.value.url;
          }
        }
      }
      if (!cancelled) setPfpUrls(urls);
    }

    fetchPfps();
    return () => {
      cancelled = true;
    };
  }, [members]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setCrewFilter(null);
    setTurtleFilter(null);
    setSort("name_asc");
    setPage(1);
  }

  const hasActiveFilters = !!(search || crewFilter || turtleFilter || sort !== "name_asc");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-page-bg)",
        color: "var(--color-text)",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
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
            ← Back to Home
          </Link>
          <h1
            style={{
              margin: "8px 0 4px 0",
              fontSize: 32,
              fontWeight: 800,
              color: "var(--color-text-primary, var(--color-text))",
            }}
          >
            Crew
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              color: "var(--color-text-secondary, var(--color-text))",
              opacity: 0.8,
            }}
          >
            All PizzaDAO members who have signed up
          </p>
        </div>

        {/* Search + clear */}
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="Search name, city, orgs, or skills..."
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
                border:
                  "1px solid var(--color-border-strong, var(--color-border))",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                cursor: "pointer",
              }}
            >
              Search
            </button>
            {hasActiveFilters && (
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

          {/* Crew chips */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 12,
                opacity: 0.7,
                marginRight: 4,
              }}
            >
              Crews:
            </span>
            <FilterChip
              label="All"
              active={!crewFilter}
              onClick={() => {
                setCrewFilter(null);
                setPage(1);
              }}
            />
            {CREWS.map((c) => {
              const count = crewCounts.find((cc) => cc.id === c.id)?.count ?? 0;
              return (
                <FilterChip
                  key={c.id}
                  label={`${c.label}${count ? ` (${count})` : ""}`}
                  active={crewFilter === c.id}
                  onClick={() => {
                    setCrewFilter(crewFilter === c.id ? null : c.id);
                    setPage(1);
                  }}
                />
              );
            })}
          </div>

          {/* Turtle chips */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 12,
                opacity: 0.7,
                marginRight: 4,
              }}
            >
              Turtles:
            </span>
            <FilterChip
              label="All"
              active={!turtleFilter}
              onClick={() => {
                setTurtleFilter(null);
                setPage(1);
              }}
            />
            {TURTLES.map((t) => {
              const count =
                turtleCounts.find((tc) => tc.id === t.id)?.count ?? 0;
              return (
                <FilterChip
                  key={t.id}
                  label={`${t.label}${count ? ` (${count})` : ""}`}
                  active={turtleFilter === t.id}
                  onClick={() => {
                    setTurtleFilter(turtleFilter === t.id ? null : t.id);
                    setPage(1);
                  }}
                />
              );
            })}
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
                ? "No members match your filters"
                : `Showing ${members.length} of ${pagination.total} member${
                    pagination.total === 1 ? "" : "s"
                  }`}
            </span>
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
              <option value="name_asc">Name A–Z</option>
              <option value="name_desc">Name Z–A</option>
              <option value="most_calls">Most Calls</option>
              <option value="recent_call">Most Recent Call</option>
            </select>
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

        {/* Loading skeleton */}
        {loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  height: 110,
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
        {!loading && !error && members.length === 0 && (
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
              No members match your filters.
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

        {/* Grid */}
        {!loading && !error && members.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {members.map((member) => (
              <MemberCardItem
                key={member.id}
                member={member}
                pfpUrl={pfpUrls[member.id]}
              />
            ))}
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
              onClick={() => setPage(Math.min(pagination.totalPages, page + 1))}
              disabled={page >= pagination.totalPages}
              style={{
                padding: "8px 14px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                cursor:
                  page >= pagination.totalPages ? "not-allowed" : "pointer",
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

function MemberCardItem({
  member,
  pfpUrl,
}: {
  member: PublicMember;
  pfpUrl?: string;
}) {
  return (
    <Link
      href={`/profile/${member.id}`}
      style={{
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
          height: "100%",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "var(--shadow-card)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "none";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          {pfpUrl ? (
            <img
              src={pfpUrl}
              alt={member.name}
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                objectFit: "cover",
                objectPosition: "top",
                flexShrink: 0,
                border: "2px solid #fafafa",
              }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {member.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 16,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {member.name}
            </div>
            {member.city && (
              <div
                style={{
                  fontSize: 13,
                  opacity: 0.7,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {member.city}
              </div>
            )}

            {/* Attendance */}
            {member.totalCalls > 0 && (
              <div
                style={{
                  fontSize: 12,
                  opacity: 0.6,
                  marginTop: 2,
                }}
              >
                {member.totalCalls} call{member.totalCalls === 1 ? "" : "s"}
                {member.lastCallDate && (
                  <>
                    {" · Last: "}
                    {new Date(member.lastCallDate).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </>
                )}
              </div>
            )}

            {/* Crew badges */}
            {member.crews.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                {member.crews.slice(0, 3).map((crewId) => {
                  const def = CREWS.find(
                    (c) => c.id.toLowerCase() === crewId.toLowerCase()
                  );
                  return (
                    <span
                      key={crewId}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 7px",
                        borderRadius: 10,
                        background: "rgba(91,156,255,0.12)",
                        color: "#5b9cff",
                        textTransform: "capitalize",
                      }}
                    >
                      {def?.label || crewId}
                    </span>
                  );
                })}
                {member.crews.length > 3 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      opacity: 0.6,
                    }}
                  >
                    +{member.crews.length - 3}
                  </span>
                )}
              </div>
            )}

            {/* Turtle badges */}
            {member.turtles.length > 0 && (
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                {member.turtles.map((tName) => {
                  const tDef = TURTLES.find(
                    (t) =>
                      t.id.toLowerCase() === tName.toLowerCase() ||
                      t.label.toLowerCase() === tName.toLowerCase()
                  );
                  if (!tDef) return null;
                  return (
                    <img
                      key={tDef.id}
                      src={tDef.image}
                      alt={tDef.label}
                      title={tDef.label}
                      style={{
                        width: 22,
                        height: 22,
                        objectFit: "contain",
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
