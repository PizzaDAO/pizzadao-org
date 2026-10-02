"use client";

// Editorial restyle: § overline masthead, paper-soft search strip and
// press-clipping event rows. Fetching and search are unchanged.

import { useEffect, useState } from "react";
import Image from "next/image";
import { isOptimizableImage } from "@/app/lib/image-hosts";
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  paperCard,
  pillInk,
} from "@/app/ui/shared/Editorial";

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
    <div
      className={`${paperCard} p-3 sm:p-4 hover:border-[hsl(var(--tomato)/0.6)] transition-colors duration-200`}
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="flex gap-3 items-center">
        {/* POAP Image - links to gallery */}
        <a
          href={`https://poap.gallery/event/${event.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 bg-muted block border border-[hsl(var(--rule-warm)/0.65)]"
        >
          {event.imageUrl ? (
            <Image
              src={event.imageUrl}
              alt={event.name}
              width={56}
              height={56}
              sizes="56px"
              unoptimized={!isOptimizableImage(event.imageUrl)}
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
            className="font-display text-base sm:text-lg font-black tracking-tight text-foreground hover:text-tomato no-underline transition-colors line-clamp-2 leading-tight"
          >
            {event.name}
          </a>

          <div className="overline mt-1.5 text-foreground/55" style={{ fontSize: 10 }}>
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
            className={`w-9 h-9 rounded-full border border-[hsl(var(--rule-warm)/0.65)] text-muted-foreground hover:border-tomato hover:text-tomato text-base cursor-pointer flex items-center justify-center flex-shrink-0 transition-colors font-display font-semibold ${
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
        <p className="rule-warm mt-3 mb-0 pt-3 text-sm text-foreground/70 leading-relaxed">
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
    <EditorialPage width="max-w-3xl">
      <EditorialMasthead
        overline="The POAPs"
        title={
          <>
            Proof we <span className="text-tomato underline-scribble">showed up</span>
          </>
        }
        dek={
          !loading && data
            ? `${data.totalCount} whitelisted event${data.totalCount === 1 ? "" : "s"}.`
            : "Whitelisted PizzaDAO POAP events."
        }
      />

      {/* Search */}
      <div className={`${paperCard} print-noise mb-8 p-4 sm:p-5`}>
        <div className="relative">
          <span aria-hidden className="overline absolute left-3 top-2 text-foreground/40" style={{ fontSize: 9 }}>
            Search
          </span>
          <input
            type="text"
            placeholder="Find a POAP…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-11 pt-6 pb-2 px-3 text-base sm:text-sm rounded-[var(--radius)] bg-[hsl(var(--cream))] dark:bg-card text-foreground border border-[hsl(var(--rule-warm)/0.55)] outline-none focus:border-[hsl(var(--tomato))] focus:ring-2 focus:ring-[hsl(var(--tomato)/0.30)] transition-colors"
          />
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={`${paperCard} h-[88px] animate-pulse`} />
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

      {/* Events list */}
      {!loading && !error && data && (
        <>
          {filteredEvents && filteredEvents.length === 0 ? (
            <EmptyState
              title={searchQuery ? "No POAPs match your search." : "No whitelisted POAPs found."}
            />
          ) : (
            <div className="grid gap-3">
              {filteredEvents?.map((event) => (
                <POAPEventCard key={event.id} event={event} />
              ))}
            </div>
          )}

          {searchQuery && filteredEvents && filteredEvents.length > 0 && (
            <p className="overline mt-6 text-center text-foreground/55">
              Showing {filteredEvents.length} of {data.totalCount} POAPs
            </p>
          )}
        </>
      )}
    </EditorialPage>
  );
}
