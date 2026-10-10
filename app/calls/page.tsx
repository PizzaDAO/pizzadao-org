"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  FilterChip,
  paperCard,
  pillOutline,
} from "@/app/ui/shared/Editorial";

// Editorial restyle: § masthead, paper-soft filter strip and call rows,
// pill pagination. Fetching, filters, sort and attendee expansion unchanged.

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
  const t = useTranslations("callsPage");
  const locale = useLocale();
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
        throw new Error(t("loadError"));
      }
      const data = await res.json();
      setCalls(data.calls || []);
      setPagination(
        data.pagination || { page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 1 }
      );
      setCrewCounts(data.filters?.crews || []);
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [page, crewFilter, sort, t]);

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
    return d.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <EditorialPage width="max-w-[900px]">
      <EditorialMasthead
        overline={t("overline")}
        title={
          <>
            {t("titlePrefix")} <span className="text-tomato-readable underline-scribble">{t("titleAccent")}</span>
          </>
        }
        dek={
          !loading && !error
            ? t("recorded", { count: pagination.total })
            : t("description")
        }
      />

      <Link href="/crews" className="mb-6 inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">{t("upcoming")}</Link>

      {/* Crew filter chips */}
      <div className={`${paperCard} print-noise mb-6 p-4 sm:p-5`}>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="overline text-foreground/70 mr-1">{t("filedUnder")}</span>
          <FilterChip
            label={t("all")}
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
        <div className="flex flex-wrap justify-between items-end gap-3 mb-4">
          <div>
            <p className="overline text-foreground/70 m-0">{t("ledger")}</p>
            <p className="font-display text-lg font-black tracking-tight text-foreground m-0 mt-1">
              {pagination.total === 0
                ? t("noMatches")
                : t("showing", { shown: calls.length, total: pagination.total })}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className={pillOutline}>
                {t("clear")}
              </button>
            )}
            <label className="sr-only" htmlFor="calls-sort">
              Sort calls
            </label>
            <select
              id="calls-sort"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="min-h-11 px-4 rounded-full text-sm font-semibold bg-card text-foreground border border-[hsl(var(--rule-warm)/0.65)] cursor-pointer outline-none focus:border-tomato focus:ring-2 focus:ring-[hsl(var(--tomato)/0.3)]"
            >
              <option value="newest">{t("newest")}</option>
              <option value="oldest">{t("oldest")}</option>
            </select>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="p-4 mb-4 rounded-[var(--radius)] text-sm font-semibold border bg-[hsl(var(--destructive)/0.10)] border-[hsl(var(--destructive)/0.30)] text-destructive"
        >
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`${paperCard} h-14 animate-pulse opacity-60`} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && calls.length === 0 && (
        <EmptyState title={t("empty")}>
          {hasActiveFilters && (
            <button type="button" onClick={clearFilters} className={`${pillOutline} mt-3`}>
              Clear filters
            </button>
          )}
        </EmptyState>
      )}

      {/* Call list */}
      {!loading && !error && calls.length > 0 && (
        <ol className="m-0 p-0 list-none flex flex-col gap-2">
          {calls.map((call) => {
            const key = `${call.crewId}:${call.date}`;
            const isExpanded = expandedKey === key;
            return (
              <li
                key={key}
                className={`${paperCard} overflow-hidden transition-colors ${
                  isExpanded ? "border-[hsl(var(--tomato)/0.6)]" : "hover:border-[hsl(var(--tomato)/0.45)]"
                }`}
                style={{ boxShadow: "var(--shadow-soft)" }}
              >
                <button
                  type="button"
                  onClick={() => toggleExpand(call.crewId, call.date)}
                  aria-expanded={isExpanded}
                  className="w-full min-h-14 px-4 py-3 bg-transparent border-0 text-foreground cursor-pointer text-left flex items-center gap-3 flex-wrap sm:flex-nowrap"
                >
                  <span className="font-display text-base font-black tracking-tight min-w-[112px]">
                    {formatDate(call.date)}
                  </span>
                  <span
                    className="overline px-2 py-1 rounded-full bg-[hsl(var(--tomato)/0.12)] text-tomato-readable whitespace-nowrap"
                    style={{ fontSize: 13 }}
                  >
                    {call.crewLabel}
                  </span>
                  <span className="ml-auto text-sm text-muted-foreground whitespace-nowrap tabular-nums">
                    {t("attendees", { count: call.attendeeCount })}
                  </span>
                  <span
                    aria-hidden
                    className={`text-xs text-foreground/70 transition-transform duration-200 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  >
                    &#9660;
                  </span>
                </button>

                {/* Expanded attendee list */}
                {isExpanded && (
                  <div className="rule-warm px-4 py-3">
                    <p className="overline text-foreground/70 mt-0 mb-2">{t("room")}</p>
                    {detailLoading && (
                      <p className="m-0 text-sm text-muted-foreground italic">{t("loadingAttendees")}</p>
                    )}
                    {!detailLoading && !detail && (
                      <p className="m-0 text-sm text-muted-foreground italic">{t("attendeesError")}</p>
                    )}
                    {!detailLoading && detail && (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.attendees.map((a) =>
                          a.memberId ? (
                            <Link
                              key={a.discordId}
                              href={`/profile/${a.memberId}`}
                              className="text-[13px] px-2.5 py-1 rounded-full bg-[hsl(var(--tomato)/0.08)] text-tomato-readable no-underline whitespace-nowrap hover:bg-[hsl(var(--tomato)/0.16)]"
                            >
                              {a.displayName}
                            </Link>
                          ) : (
                            <span
                              key={a.discordId}
                              className="text-[13px] px-2.5 py-1 rounded-full bg-[hsl(var(--ink)/0.06)] text-foreground/70 whitespace-nowrap"
                            >
                              {a.displayName}
                            </span>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Pagination */}
      {!loading && pagination.totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setPage(Math.max(1, page - 1));
              setExpandedKey(null);
            }}
            disabled={page <= 1}
            className={pillOutline}
          >
            {t("prev")}
          </button>
          <span className="overline text-foreground/70">
            {t("page", { current: pagination.page, total: pagination.totalPages })}
          </span>
          <button
            type="button"
            onClick={() => {
              setPage(Math.min(pagination.totalPages, page + 1));
              setExpandedKey(null);
            }}
            disabled={page >= pagination.totalPages}
            className={pillOutline}
          >
            {t("next")}
          </button>
        </div>
      )}
    </EditorialPage>
  );
}
