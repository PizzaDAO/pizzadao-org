"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { VouchCard } from "../ui/vouches/VouchCard";
import { useMe, useVouches } from "../lib/hooks/use-api";
import {
  btn,
  card,
  input as inputStyle,
  loadingSpinner,
  pageContainer,
} from "../ui/shared-styles";

type VouchData = {
  memberId: string;
  name: string;
  city: string;
  crews: string;
  source: "PIZZADAO" | "TWITTER" | "FARCASTER";
};

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

export default function VouchesPage() {
  const router = useRouter();

  // --- React Query hooks ---
  const { data: meData, isLoading: meLoading, error: meError } = useMe();
  const memberId = meData?.memberId ?? null;
  // Internal PIZZADAO vouches only — Farcaster/Twitter sources are out of scope here.
  const { data: vouchesData, isLoading: vouchesLoading } = useVouches(
    memberId,
    { limit: 200, source: "PIZZADAO" },
  );

  const loading = meLoading || (!!memberId && vouchesLoading);
  const authError = meError
    ? "Please log in to view your vouches"
    : meData && !memberId
    ? "Could not find your member profile"
    : null;

  // Local state for vouches/counts (mutated optimistically on remove)
  const [vouches, setVouches] = useState<VouchData[]>([]);
  const [counts, setCounts] = useState({
    pizzadao: 0,
    pizzadaoFollowers: 0,
  });

  // Sync hook data to local state
  useEffect(() => {
    if (vouchesData) {
      setVouches(vouchesData.vouches || []);
      setCounts({
        pizzadao: vouchesData.counts?.pizzadao ?? 0,
        pizzadaoFollowers: vouchesData.counts?.pizzadaoFollowers ?? 0,
      });
    }
  }, [vouchesData]);

  const [searchQuery, setSearchQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemove = async (targetMemberId: string) => {
    setRemovingId(targetMemberId);
    try {
      const res = await fetch("/api/vouches/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetMemberId }),
      });

      if (res.ok) {
        setVouches((prev) =>
          prev.filter((v) => v.memberId !== targetMemberId)
        );
        setCounts((prev) => ({
          ...prev,
          pizzadao: Math.max(0, prev.pizzadao - 1),
        }));
      }
    } catch {
      // Silently fail
    } finally {
      setRemovingId(null);
    }
  };

  // Filter by search only (source filter removed — only PIZZADAO comes from the API now)
  const filteredVouches = vouches.filter((v) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      v.city.toLowerCase().includes(q) ||
      v.crews.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div
        style={{
          ...pageContainer(),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={loadingSpinner()} />
          <p
            style={{
              fontSize: 18,
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Loading vouches…
          </p>
          <style jsx>{`
            @keyframes spin {
              0% {
                transform: rotate(0deg);
              }
              100% {
                transform: rotate(360deg);
              }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div
        style={{
          ...pageContainer(),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={card()}>
          <h1
            style={{
              fontFamily: displayFont,
              fontSize: 32,
              fontWeight: 800,
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            Vouches
          </h1>
          <p
            style={{
              color: "hsl(var(--muted-foreground))",
              margin: 0,
            }}
          >
            {authError}
          </p>
          <Link href="/" style={btn("primary")}>
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={pageContainer()}>
      <div
        style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 20 }}
      >
        {/* Back Button */}
        <div>
          <button
            onClick={() => router.back()}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 600,
              color: "hsl(var(--muted-foreground))",
              padding: 0,
              fontFamily: "inherit",
            }}
          >
            ← Back
          </button>
        </div>

        {/* Header */}
        <header style={{ textAlign: "center", marginBottom: 10 }}>
          <h1
            style={{
              marginTop: 0,
              fontFamily: displayFont,
              fontSize: 44,
              marginBottom: 8,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              textWrap: "balance",
            }}
          >
            Vouches
          </h1>
          <p
            style={{
              fontSize: 16,
              color: "hsl(var(--muted-foreground))",
              margin: 0,
            }}
          >
            {counts.pizzadao} vouching for · {counts.pizzadaoFollowers} vouchers
          </p>
        </header>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search vouches by name, city, or crew…"
          style={inputStyle()}
        />

        {/* Vouches Grid */}
        {filteredVouches.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {filteredVouches.map((v) => (
              <VouchCard
                key={v.memberId}
                memberId={v.memberId}
                name={v.name}
                city={v.city}
                crews={v.crews}
                source={v.source}
                isOwnList={true}
                onRemove={handleRemove}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: 40,
              borderRadius: "var(--radius)",
              border: "1px dashed hsl(var(--rule) / 0.22)",
              background: "hsl(var(--card))",
              textAlign: "center",
            }}
          >
            {vouches.length === 0 ? (
              <>
                <p
                  style={{
                    fontFamily: displayFont,
                    fontSize: 18,
                    fontWeight: 700,
                    marginBottom: 8,
                    color: "hsl(var(--foreground))",
                  }}
                >
                  No vouches yet
                </p>
                <p
                  style={{
                    fontSize: 14,
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: 16,
                  }}
                >
                  Visit a member profile and tap “+ Vouch” to add one.
                </p>
              </>
            ) : (
              <p
                style={{
                  fontSize: 14,
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                No vouches match your search.
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: 40,
            color: "hsl(var(--muted-foreground))",
            fontFamily: displayFont,
            fontSize: 13,
            opacity: 0.6,
          }}
        >
          PizzaDAO
        </div>
      </div>
    </div>
  );
}
