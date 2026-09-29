"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/app/lib/hooks/use-session";

interface CityChatListItem {
  slug: string;
  name: string;
  country: string | null;
  region: string | null;
  isSupergroup: boolean;
}

interface RegionCount {
  id: string;
  count: number;
}

interface ChatsResponse {
  cities: CityChatListItem[];
  regions: RegionCount[];
}

// Turn a region slug ("western-europe", "usa") into a readable label.
function regionLabel(id: string): string {
  const upper = new Set(["usa", "uk", "uae"]);
  if (upper.has(id.toLowerCase())) return id.toUpperCase();
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function ChatsPage() {
  const router = useRouter();
  const { data: session, isLoading } = useSession();

  const [cities, setCities] = useState<CityChatListItem[]>([]);
  const [regions, setRegions] = useState<RegionCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState<string | null>(null);

  // Redirect unauthenticated users to login.
  useEffect(() => {
    if (!isLoading && !session?.authenticated) {
      router.push("/api/discord/login");
    }
  }, [isLoading, session?.authenticated, router]);

  // Debounce search input.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Fetch the directory once authenticated.
  useEffect(() => {
    if (isLoading || !session?.authenticated) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/chats");
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || "Failed to load chats");
        }
        const data: ChatsResponse = await res.json();
        if (cancelled) return;
        setCities(data.cities || []);
        setRegions(data.regions || []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isLoading, session?.authenticated]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return cities.filter((c) => {
      if (regionFilter && c.region !== regionFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cities, search, regionFilter]);

  // While checking auth, show a loading state. Render nothing if unauthenticated.
  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "var(--color-page-bg)",
          color: "var(--color-text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          opacity: 0.7,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!session?.authenticated) {
    return null;
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
            Find your city&apos;s Pizza Party chat
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 15,
              color: "var(--color-text-secondary, var(--color-text))",
              opacity: 0.8,
            }}
          >
            Join the Telegram group for your local Global Pizza Party city.
          </p>
        </div>

        {/* Search + region chips */}
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <input
            type="text"
            placeholder="Search for your city..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 16px",
              fontSize: 14,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              outline: "none",
              background: "var(--color-surface)",
              color: "var(--color-text)",
            }}
          />

          {/* Region chips */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, opacity: 0.7, marginRight: 4 }}>
              Regions:
            </span>
            <FilterChip
              label="All"
              active={!regionFilter}
              onClick={() => setRegionFilter(null)}
            />
            {regions.map((r) => (
              <FilterChip
                key={r.id}
                label={`${regionLabel(r.id)} (${r.count})`}
                active={regionFilter === r.id}
                onClick={() =>
                  setRegionFilter(regionFilter === r.id ? null : r.id)
                }
              />
            ))}
          </div>
        </div>

        {/* Count */}
        {!loading && !error && (
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
            {filtered.length === 0
              ? "No cities match your search"
              : `Showing ${filtered.length} of ${cities.length} cit${
                  cities.length === 1 ? "y" : "ies"
                }`}
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
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  height: 72,
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
        {!loading && !error && filtered.length === 0 && (
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
              No cities match your search.
            </p>
          </div>
        )}

        {/* Grid */}
        {!loading && !error && filtered.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((city) => (
              <CityCard key={city.slug} city={city} />
            ))}
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

function CityCard({ city }: { city: CityChatListItem }) {
  const subtitle = [
    city.region ? regionLabel(city.region) : null,
    city.country,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/chats/${city.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      style={{ textDecoration: "none", color: "inherit" }}
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
        <div
          style={{
            fontWeight: 700,
            fontSize: 16,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {city.name}
        </div>
        {subtitle && (
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
            {subtitle}
          </div>
        )}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--color-accent, #5b9cff)",
            }}
          >
            Open Telegram →
          </span>
          {city.isSupergroup && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 10,
                background: "rgba(91,156,255,0.12)",
                color: "#5b9cff",
              }}
            >
              Supergroup
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
