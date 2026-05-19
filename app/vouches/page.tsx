"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { VouchCard } from "../ui/vouches/VouchCard";
import { SocialAccountLinker } from "../ui/vouches/SocialAccountLinker";
import { FarcasterDiscovery } from "../ui/vouches/FarcasterDiscovery";
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

type FilterTab = "ALL" | "PIZZADAO" | "FARCASTER" | "TWITTER";

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

export default function VouchesPage() {
  const router = useRouter();

  // --- React Query hooks ---
  const { data: meData, isLoading: meLoading, error: meError } = useMe();
  const memberId = meData?.memberId ?? null;
  const { data: vouchesData, isLoading: vouchesLoading } = useVouches(memberId, { limit: 200 });

  const loading = meLoading || (!!memberId && vouchesLoading);
  const authError = meError
    ? "Please log in to view your vouches"
    : meData && !memberId
    ? "Could not find your member profile"
    : null;

  // Local state for vouches/counts (mutated optimistically on remove)
  const [vouches, setVouches] = useState<VouchData[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    pizzadao: 0,
    farcaster: 0,
    twitter: 0,
    followers: 0,
  });

  // Sync hook data to local state
  useEffect(() => {
    if (vouchesData) {
      setVouches(vouchesData.vouches || []);
      setCounts(
        vouchesData.counts || {
          total: 0,
          pizzadao: 0,
          farcaster: 0,
          twitter: 0,
          followers: 0,
        }
      );
    }
  }, [vouchesData]);

  const [activeTab, setActiveTab] = useState<FilterTab>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [hasFarcaster, setHasFarcaster] = useState(false);

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
          total: Math.max(0, prev.total - 1),
          pizzadao: Math.max(0, prev.pizzadao - 1),
        }));
      }
    } catch {
      // Silently fail
    } finally {
      setRemovingId(null);
    }
  };

  // Filter vouches
  const filteredVouches = vouches.filter((v) => {
    if (activeTab !== "ALL" && v.source !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        v.name.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q) ||
        v.crews.toLowerCase().includes(q)
      );
    }
    return true;
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

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "ALL", label: "All", count: counts.total },
    { id: "PIZZADAO", label: "PizzaDAO", count: counts.pizzadao },
    { id: "FARCASTER", label: "Farcaster", count: counts.farcaster },
    { id: "TWITTER", label: "X", count: counts.twitter },
  ];

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
            {counts.total} vouching for · {counts.followers} vouchers
          </p>
        </header>

        {/* Social Account Linking */}
        {memberId && (
          <div style={card()}>
            <SocialAccountLinker
              memberId={memberId}
              onAccountChange={(accounts) => {
                setHasFarcaster(
                  accounts.some((a) => a.platform === "FARCASTER")
                );
              }}
            />
          </div>
        )}

        {/* Farcaster Discovery */}
        {memberId && hasFarcaster && (
          <div style={card()}>
            <FarcasterDiscovery currentMemberId={memberId} />
          </div>
        )}

        {/* Filter Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 4,
            borderRadius: "var(--radius)",
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--rule) / 0.12)",
          }}
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: "calc(var(--radius) - 4px)",
                  border: "none",
                  background: active ? "hsl(var(--primary))" : "transparent",
                  color: active
                    ? "hsl(var(--primary-foreground))"
                    : "hsl(var(--muted-foreground))",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: displayFont,
                  cursor: "pointer",
                  transition:
                    "background-color 150ms ease, color 150ms ease",
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      opacity: 0.75,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

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
                  Visit member profiles to vouch for them, or link your social
                  accounts to discover vouches.
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
