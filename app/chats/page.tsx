"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/app/lib/hooks/use-session";
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  FilterChip,
  LoadingLine,
  paperCard,
} from "@/app/ui/shared/Editorial";

// Editorial restyle: § masthead, paper-soft search strip and city cards on
// the semantic HSL tokens (was legacy --color-* vars). Auth gate, search
// debounce and region filter unchanged.

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
      router.push("/login?returnTo=/chats");
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
      <EditorialPage width="max-w-[1200px]">
        <LoadingLine label="Loading…" />
      </EditorialPage>
    );
  }

  if (!session?.authenticated) {
    return null;
  }

  return (
    <EditorialPage width="max-w-[1200px]">
      <EditorialMasthead
        overline="The Party Lines"
        title={
          <>
            Find your city&apos;s <span className="text-tomato underline-scribble">Pizza Party</span> chat
          </>
        }
        dek="Join the Telegram group for your local Global Pizza Party city."
      />

      {/* Search + region chips */}
      <div className={`${paperCard} print-noise mb-6 p-4 sm:p-5`}>
        <div className="flex flex-col gap-3">
          <div className="relative">
            <span
              aria-hidden
              className="overline absolute left-3 top-2 text-foreground/40"
              style={{ fontSize: 9 }}
            >
              Search
            </span>
            <input
              type="text"
              placeholder="Search for your city..."
              aria-label="Search for your city"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full min-h-11 pt-6 pb-2 px-3 text-base sm:text-sm rounded-[var(--radius)] bg-[hsl(var(--cream))] dark:bg-card text-foreground border border-[hsl(var(--rule-warm)/0.55)] outline-none focus:border-tomato focus:ring-2 focus:ring-[hsl(var(--tomato)/0.30)] transition-colors"
            />
          </div>

          {/* Region chips */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="overline text-foreground/45 mr-1">Regions</span>
            <FilterChip label="All" active={!regionFilter} onClick={() => setRegionFilter(null)} />
            {regions.map((r) => (
              <FilterChip
                key={r.id}
                label={`${regionLabel(r.id)} (${r.count})`}
                active={regionFilter === r.id}
                onClick={() => setRegionFilter(regionFilter === r.id ? null : r.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Count */}
      {!loading && !error && (
        <div className="mb-4">
          <p className="overline text-foreground/45 m-0">The directory</p>
          <p className="font-display text-lg font-black tracking-tight text-foreground m-0 mt-1">
            {filtered.length === 0
              ? "No cities match your search"
              : `Showing ${filtered.length} of ${cities.length} cit${cities.length === 1 ? "y" : "ies"}`}
          </p>
        </div>
      )}

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
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))" }}
          aria-busy="true"
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`${paperCard} h-[84px] animate-pulse opacity-60`} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && <EmptyState title="No cities match your search." />}

      {/* Grid */}
      {!loading && !error && filtered.length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))" }}
        >
          {filtered.map((city) => (
            <CityCard key={city.slug} city={city} />
          ))}
        </div>
      )}
    </EditorialPage>
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
      className={`${paperCard} group block h-full p-4 no-underline text-inherit transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--tomato)/0.6)]`}
      style={{ boxShadow: "var(--shadow-soft)" }}
    >
      <div className="font-display text-lg font-black tracking-tight text-foreground truncate group-hover:text-tomato transition-colors">
        {city.name}
      </div>
      {subtitle && <div className="overline text-foreground/50 mt-1 truncate">{subtitle}</div>}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs font-semibold text-tomato">Open Telegram →</span>
        {city.isSupergroup && (
          <span
            className="overline px-1.5 py-0.5 rounded-md bg-[hsl(var(--butter)/0.35)] text-ink"
            style={{ fontSize: 9.5 }}
          >
            Supergroup
          </span>
        )}
      </div>
    </Link>
  );
}
