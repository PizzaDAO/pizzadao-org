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

function POAPEventCard({ event }: { event: POAPEvent }) {
  const location = [event.city, event.country].filter(Boolean).join(", ");

  return (
    <a
      href={`https://poap.gallery/event/${event.id}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        gap: 16,
        padding: 16,
        background: "white",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.08)",
        textDecoration: "none",
        color: "inherit",
        transition: "all 0.2s ease",
      }}
      className="poap-card"
    >
      {/* POAP Image */}
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          background: "#f5f5f5",
        }}
      >
        {event.imageUrl ? (
          <img
            src={event.imageUrl}
            alt={event.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#999",
              fontSize: 12,
            }}
          >
            No Image
          </div>
        )}
      </div>

      {/* Event Details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: "#111",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {event.name}
        </h3>

        {event.description && (
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: 13,
              color: "#666",
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {event.description}
          </p>
        )}

        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 8,
            fontSize: 12,
            color: "#888",
            flexWrap: "wrap",
          }}
        >
          {event.startDate && <span>📅 {formatDate(event.startDate)}</span>}
          {location && <span>📍 {location}</span>}
        </div>
      </div>

      {/* Arrow */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          color: "#ccc",
          fontSize: 18,
        }}
      >
        →
      </div>
    </a>
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
              display: "inline-block",
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
            PizzaDAO POAPs
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "#666" }}>
            Explore all {data?.totalCount || "..."} whitelisted POAP events
          </p>
        </div>

        {/* Search */}
        <div style={{ marginBottom: 24 }}>
          <input
            type="text"
            placeholder="Search POAPs..."
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
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ display: "grid", gap: 12 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  height: 112,
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
                padding: "10px 20px",
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

        {/* Events list */}
        {!loading && !error && data && (
          <>
            {filteredEvents && filteredEvents.length === 0 ? (
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
                  {searchQuery
                    ? "No POAPs match your search."
                    : "No whitelisted POAPs found."}
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {filteredEvents?.map((event) => (
                  <POAPEventCard key={event.id} event={event} />
                ))}
              </div>
            )}

            {searchQuery && filteredEvents && filteredEvents.length > 0 && (
              <p
                style={{
                  marginTop: 16,
                  textAlign: "center",
                  fontSize: 13,
                  color: "#888",
                }}
              >
                Showing {filteredEvents.length} of {data.totalCount} POAPs
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
        .poap-card:hover {
          border-color: rgba(234, 179, 8, 0.5) !important;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
      `}</style>
    </div>
  );
}
