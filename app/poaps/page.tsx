"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface POAPEvent {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  startDate: string;
  endDate: string;
  city: string;
  country: string;
  eventUrl: string;
}

interface WhitelistData {
  events: POAPEvent[];
  totalCount: number;
  fromCache: boolean;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * POAPEventCard — capers-48272 (Phase 4e restyle)
 * Single POAP row with circular thumbnail, title, date, expandable info.
 * Tomato hover ring matches the rest of the collection cards.
 */
function POAPEventCard({ event }: { event: POAPEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-3 bg-card rounded-[var(--radius)] border border-rule hover:border-tomato hover:shadow-md transition-all duration-200">
      <div className="flex gap-3 items-center">
        {/* POAP Image - links to gallery */}
        <a
          href={`https://poap.gallery/event/${event.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 bg-muted block border border-rule"
        >
          {event.imageUrl ? (
            <img
              src={event.imageUrl}
              alt={event.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[10px] italic">
              No Image
            </div>
          )}
        </a>

        {/* Event Details */}
        <div className="flex-1 min-w-0">
          <a
            href={`https://poap.gallery/event/${event.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-display text-base font-semibold text-foreground hover:text-tomato no-underline transition-colors line-clamp-2 leading-tight"
          >
            {event.name}
          </a>

          <div className="mt-1 text-[13px] text-muted-foreground">
            {event.startDate && <span>{formatDate(event.startDate)}</span>}
            {event.city && (
              <span className="ml-2">
                · {event.city}
                {event.country ? `, ${event.country}` : ""}
              </span>
            )}
          </div>
        </div>

        {/* Info button */}
        {event.description && (
          <button
            onClick={() => setExpanded(!expanded)}
            className={`w-9 h-9 rounded-full border border-rule text-muted-foreground hover:border-tomato hover:text-tomato text-base cursor-pointer flex items-center justify-center flex-shrink-0 transition-colors font-display font-semibold ${
              expanded ? "bg-muted" : "bg-background"
            }`}
            aria-label={expanded ? "Hide description" : "Show description"}
          >
            {expanded ? "−" : "i"}
          </button>
        )}
      </div>

      {/* Expanded description */}
      {expanded && event.description && (
        <p className="mt-3 pt-3 border-t border-rule text-sm text-muted-foreground leading-relaxed">
          {event.description}
        </p>
      )}
    </div>
  );
}

export default function POAPsPage() {
  const [data, setData] = useState<WhitelistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/poaps/whitelist");
        if (!res.ok) throw new Error("Failed to fetch POAPs");
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Filter events by search query
  const filteredEvents = data?.events.filter((event) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      event.name.toLowerCase().includes(query) ||
      event.description?.toLowerCase().includes(query) ||
      event.city?.toLowerCase().includes(query) ||
      event.country?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-screen bg-background text-foreground px-5 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-tomato no-underline inline-flex items-center min-h-[44px] transition-colors"
          >
            ← Back to Home
          </Link>
          <h1 className="font-display mt-2 mb-1 text-4xl font-extrabold tracking-tight text-foreground">
            POAPs
          </h1>
          {!loading && data && (
            <p className="m-0 text-sm text-muted-foreground">
              {data.totalCount} whitelisted event{data.totalCount === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search POAPs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 text-sm rounded-[var(--radius)] border border-rule bg-card text-foreground outline-none focus:border-tomato focus:shadow-[0_0_0_3px_hsl(var(--tomato)/0.15)] transition-all"
          />
        </div>

        {/* Loading state */}
        {loading && (
          <div className="grid gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-[88px] rounded-[var(--radius)] border border-rule bg-card animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="p-10 text-center rounded-[var(--radius)] border border-rule bg-card">
            <p className="text-base text-destructive italic mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-3 min-h-[44px] text-sm font-display font-semibold rounded-[var(--radius)] bg-primary text-primary-foreground hover:bg-tomato hover:text-cream border-0 cursor-pointer transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Events list */}
        {!loading && !error && data && (
          <>
            {filteredEvents && filteredEvents.length === 0 ? (
              <div className="p-10 text-center rounded-[var(--radius)] border border-rule bg-card">
                <p className="text-base text-muted-foreground italic">
                  {searchQuery
                    ? "No POAPs match your search."
                    : "No whitelisted POAPs found."}
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredEvents?.map((event) => (
                  <POAPEventCard key={event.id} event={event} />
                ))}
              </div>
            )}

            {searchQuery && filteredEvents && filteredEvents.length > 0 && (
              <p className="mt-4 text-center text-[13px] text-muted-foreground italic">
                Showing {filteredEvents.length} of {data.totalCount} POAPs
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
