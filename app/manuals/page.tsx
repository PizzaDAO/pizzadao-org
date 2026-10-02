"use client";

// Editorial restyle: § overline masthead, paper-soft filter strip and
// press-clipping manual cards. Fetching, search, crew filter and the status
// multi-select are unchanged.

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  paperCard,
  pillInk,
} from "@/app/ui/shared/Editorial";

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

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "complete" || s === "completed") {
    return "bg-[hsl(142_71%_45%/0.18)] text-[hsl(142_71%_25%)] dark:text-[hsl(142_71%_65%)]";
  }
  if (s === "draft") {
    return "bg-[hsl(var(--butter)/0.35)] text-[hsl(var(--ink))] dark:text-[hsl(var(--butter))]";
  }
  if (s === "needed") {
    return "bg-[hsl(var(--tomato)/0.15)] text-tomato";
  }
  if (s === "backlog") {
    return "bg-[hsl(258_90%_66%/0.15)] text-[hsl(262_60%_45%)] dark:text-[hsl(258_90%_75%)]";
  }
  return "bg-[hsl(var(--ink)/0.08)] text-muted-foreground";
}

const fieldClass =
  "w-full min-h-11 px-3 text-base sm:text-sm rounded-[var(--radius)] bg-[hsl(var(--cream))] dark:bg-card text-foreground border border-[hsl(var(--rule-warm)/0.55)] outline-none focus:border-[hsl(var(--tomato))] focus:ring-2 focus:ring-[hsl(var(--tomato)/0.30)] transition-colors";

const CARET_BG = {
  appearance: "none" as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
};

function ManualCard({ manual, index }: { manual: Manual; index: number }) {
  return (
    <Link
      href={`/manuals/${index}`}
      className={`${paperCard} group block p-4 sm:p-5 no-underline text-inherit transition-all duration-200 hover:border-[hsl(var(--tomato)/0.6)] hover:-translate-y-px`}
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          {manual.crew && <p className="overline text-tomato m-0 mb-1 truncate">{manual.crew}</p>}
          <h3 className="font-display text-lg font-black tracking-tight leading-snug text-foreground m-0 group-hover:text-tomato transition-colors">
            {manual.title}
          </h3>
          <div className="mt-1.5 text-[13px] text-muted-foreground">
            {manual.crew && (
              <Link
                href={`/crew/${manual.crewId}`}
                className="mr-3 text-tomato no-underline hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {manual.crew} crew
              </Link>
            )}
            {manual.author && manual.authorId && (
              <span>
                by{" "}
                <Link
                  href={`/profile/${manual.authorId}`}
                  className="text-tomato no-underline hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {manual.author}
                </Link>
              </span>
            )}
            {manual.author && !manual.authorId && <span>by {manual.author}</span>}
          </div>
          {manual.lastUpdated && (
            <p className="overline text-foreground/45 mt-2 mb-0" style={{ fontSize: 10 }}>
              Updated {manual.lastUpdated}
            </p>
          )}
        </div>
        {manual.status && (
          <span
            className={`overline shrink-0 px-2 py-1 rounded-md ${statusBadgeClass(manual.status)}`}
            style={{ fontSize: 10 }}
          >
            {manual.status}
          </span>
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
    <EditorialPage width="max-w-[860px]">
      <EditorialMasthead
        overline="The Manuals"
        title={
          <>
            PizzaDAO <span className="text-tomato underline-scribble">manuals</span>
          </>
        }
        dek="Operating manuals and documentation for PizzaDAO crews."
      />

      {/* Search and Filters */}
      <div className={`${paperCard} print-noise mb-8 p-4 sm:p-5`}>
        <div className="relative flex flex-col gap-3">
          <div className="relative">
            <span aria-hidden className="overline absolute left-3 top-2 text-foreground/40" style={{ fontSize: 9 }}>
              Search
            </span>
            <input
              type="text"
              placeholder="Search manuals…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`${fieldClass} pt-6 pb-2`}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={crewFilter}
              onChange={(e) => setCrewFilter(e.target.value)}
              aria-label="Filter by crew"
              className={`${fieldClass} flex-1 pr-8 cursor-pointer`}
              style={CARET_BG}
            >
              <option value="">All Crews</option>
              {uniqueCrews.map((crew) => (
                <option key={crew} value={crew}>
                  {crew}
                </option>
              ))}
            </select>
            {/* Status multi-select dropdown */}
            <div ref={statusDropdownRef} className="flex-1 relative">
              <button
                type="button"
                onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                aria-expanded={statusDropdownOpen}
                className={`${fieldClass} pr-8 text-left cursor-pointer`}
                style={CARET_BG}
              >
                {statusFilters.length === 0
                  ? "All Statuses"
                  : statusFilters.length === uniqueStatuses.length
                  ? "All Statuses"
                  : statusFilters.join(", ")}
              </button>
              {statusDropdownOpen && (
                <div
                  className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 py-2 rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.55)] bg-card"
                  style={{ boxShadow: "var(--shadow-lifted, 0 8px 30px hsl(var(--ink) / 0.12))" }}
                >
                  <label className="flex items-center px-3 py-2 cursor-pointer text-sm border-b border-[hsl(var(--rule-warm)/0.45)]">
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
                      className="mr-2 w-4 h-4 accent-[hsl(var(--tomato))]"
                    />
                    All Statuses
                  </label>
                  {uniqueStatuses.map((status) => (
                    <label key={status} className="flex items-center px-3 py-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={statusFilters.includes(status)}
                        onChange={() => toggleStatusFilter(status)}
                        className="mr-2 w-4 h-4 accent-[hsl(var(--tomato))]"
                      />
                      {status}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`${paperCard} h-20 animate-pulse`} />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className={`${paperCard} p-10 text-center grid justify-items-center gap-4`}>
          <p className="text-base text-destructive m-0">{error}</p>
          <button type="button" onClick={() => window.location.reload()} className={pillInk}>
            Try again
          </button>
        </div>
      )}

      {/* Manuals list */}
      {!loading && !error && (
        <>
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <p className="overline text-foreground/45 m-0">On the shelf</p>
              <h2 className="font-display text-xl md:text-2xl font-black tracking-tight text-foreground mt-1 mb-0">
                {searchQuery || crewFilter ? "Filtered manuals" : "All manuals"}
              </h2>
            </div>
          </div>
          {filteredManuals.length === 0 ? (
            <EmptyState
              title={
                searchQuery || crewFilter || statusFilters.length > 0
                  ? "No manuals match your filters."
                  : "No manuals found."
              }
            />
          ) : (
            <div className="grid gap-3">
              {filteredManuals.map((manual) => {
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
              <p className="overline mt-6 text-center text-foreground/55">
                Showing {filteredManuals.length} of {manuals.length} manuals
              </p>
            )}
        </>
      )}
    </EditorialPage>
  );
}
