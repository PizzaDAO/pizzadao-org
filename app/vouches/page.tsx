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
  // Outbound: people I'm vouching for. Internal PIZZADAO only.
  const { data: outboundData, isLoading: outboundLoading } = useVouches(
    memberId,
    { limit: 200, source: "PIZZADAO", direction: "out" },
  );
  // Inbound: people vouching for me. Internal PIZZADAO only.
  const { data: inboundData, isLoading: inboundLoading } = useVouches(
    memberId,
    { limit: 200, source: "PIZZADAO", direction: "in" },
  );

  const loading =
    meLoading || (!!memberId && (outboundLoading || inboundLoading));
  const authError = meError
    ? "Please log in to view your vouches"
    : meData && !memberId
    ? "Could not find your member profile"
    : null;

  // Local state — mutated optimistically on outbound remove.
  const [outbound, setOutbound] = useState<VouchData[]>([]);
  const [inbound, setInbound] = useState<VouchData[]>([]);
  const [counts, setCounts] = useState({
    pizzadao: 0,
    pizzadaoFollowers: 0,
  });

  // Sync hook data to local state. Counts come from the outbound payload
  // (the API returns the same counts shape regardless of direction).
  useEffect(() => {
    if (outboundData) {
      setOutbound(outboundData.vouches || []);
      setCounts({
        pizzadao: outboundData.counts?.pizzadao ?? 0,
        pizzadaoFollowers: outboundData.counts?.pizzadaoFollowers ?? 0,
      });
    }
  }, [outboundData]);
  useEffect(() => {
    if (inboundData) setInbound(inboundData.vouches || []);
  }, [inboundData]);

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
        setOutbound((prev) => prev.filter((v) => v.memberId !== targetMemberId));
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

  const matchesSearch = (v: VouchData) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      v.city.toLowerCase().includes(q) ||
      v.crews.toLowerCase().includes(q)
    );
  };
  const filteredOutbound = outbound.filter(matchesSearch);
  const filteredInbound = inbound.filter(matchesSearch);

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

  const sectionHeading = (label: string, count: number) => (
    <h2
      style={{
        margin: "0 0 8px",
        fontFamily: displayFont,
        fontSize: 20,
        fontWeight: 800,
        letterSpacing: "-0.01em",
        color: "hsl(var(--foreground))",
      }}
    >
      {label}
      <span
        style={{
          marginLeft: 8,
          fontSize: 16,
          fontWeight: 700,
          color: "hsl(var(--muted-foreground))",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </span>
    </h2>
  );

  const emptyState = (msg: string, sub?: string) => (
    <div
      style={{
        padding: 32,
        borderRadius: "var(--radius)",
        border: "1px dashed hsl(var(--rule) / 0.22)",
        background: "hsl(var(--card))",
        textAlign: "center",
      }}
    >
      <p
        style={{
          fontFamily: displayFont,
          fontSize: 16,
          fontWeight: 700,
          margin: 0,
          color: "hsl(var(--foreground))",
        }}
      >
        {msg}
      </p>
      {sub && (
        <p
          style={{
            fontSize: 14,
            color: "hsl(var(--muted-foreground))",
            margin: "6px 0 0",
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );

  const grid = (items: VouchData[], showRemove: boolean) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((v) => (
        <VouchCard
          key={v.memberId}
          memberId={v.memberId}
          name={v.name}
          city={v.city}
          crews={v.crews}
          source={v.source}
          isOwnList={showRemove}
          onRemove={showRemove ? handleRemove : undefined}
        />
      ))}
    </div>
  );

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

        {/* Vouching for you (inbound) */}
        <section>
          {sectionHeading("Vouching for you", counts.pizzadaoFollowers)}
          {filteredInbound.length > 0
            ? grid(filteredInbound, false)
            : inbound.length === 0
            ? emptyState(
                "Nobody has vouched for you yet",
                "Build your reputation — ask a few members to vouch for you on their profile.",
              )
            : emptyState("No vouchers match your search.")}
        </section>

        {/* You vouch for (outbound) */}
        <section>
          {sectionHeading("You vouch for", counts.pizzadao)}
          {filteredOutbound.length > 0
            ? grid(filteredOutbound, true)
            : outbound.length === 0
            ? emptyState(
                "You haven't vouched for anyone yet",
                "Visit a member profile and tap “+ Vouch” to add one.",
              )
            : emptyState("No vouches match your search.")}
        </section>

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
