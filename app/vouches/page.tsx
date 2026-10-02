"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { VouchCard } from "../ui/vouches/VouchCard";
import { useMe, useVouches } from "../lib/hooks/use-api";
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  LoadingLine,
  SectionHeading,
  paperCard,
  pillInk,
} from "../ui/shared/Editorial";

// Editorial restyle: § masthead, paper-soft search strip, overline section
// headings and dashed empty states. Hooks, optimistic remove and search
// unchanged.

type VouchData = {
  memberId: string;
  name: string;
  city: string;
  crews: string;
  source: "PIZZADAO" | "TWITTER" | "FARCASTER";
};

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
      <EditorialPage width="max-w-[800px]">
        <LoadingLine label="Loading vouches…" />
      </EditorialPage>
    );
  }

  if (authError) {
    return (
      <EditorialPage width="max-w-[640px]">
        <div className={`${paperCard} p-7 grid gap-3`} style={{ boxShadow: "var(--shadow-soft)" }}>
          <p className="overline text-tomato m-0">§ The Vouches</p>
          <h1
            className="font-display font-black tracking-tight text-foreground m-0"
            style={{ fontSize: "clamp(1.9rem, 5vw, 2.6rem)", lineHeight: 1 }}
          >
            Vouches
          </h1>
          <p className="text-muted-foreground m-0">{authError}</p>
          <Link href="/" className={`${pillInk} justify-self-start`}>
            Back to Home
          </Link>
        </div>
      </EditorialPage>
    );
  }

  const grid = (items: VouchData[], showRemove: boolean) => (
    <div
      className="grid gap-3"
      // sicilian-41551: floor lowered + `min(…, 100%)` so a 320px viewport
      // can't force the cards to overflow horizontally.
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))" }}
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
    <EditorialPage width="max-w-[800px]">
      {/* Back Button */}
      <button
        type="button"
        onClick={() => router.back()}
        className="overline mb-6 min-h-11 bg-transparent border-0 p-0 cursor-pointer text-muted-foreground hover:text-tomato"
      >
        ← Back
      </button>

      <EditorialMasthead
        overline="The Vouches"
        title={
          <>
            Who&apos;s got <span className="text-tomato underline-scribble">your back</span>
          </>
        }
        dek={
          <span className="tabular-nums">
            {counts.pizzadao} vouching for · {counts.pizzadaoFollowers} vouchers
          </span>
        }
      />

      {/* Search */}
      <div className={`${paperCard} print-noise mb-8 p-4 sm:p-5`}>
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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vouches by name, city, or crew…"
            aria-label="Search vouches"
            className="w-full min-h-11 pt-6 pb-2 px-3 text-base sm:text-sm rounded-[var(--radius)] bg-[hsl(var(--cream))] dark:bg-card text-foreground border border-[hsl(var(--rule-warm)/0.55)] outline-none focus:border-tomato focus:ring-2 focus:ring-[hsl(var(--tomato)/0.30)] transition-colors"
          />
        </div>
      </div>

      {/* Vouching for you (inbound) */}
      <section className="mb-10">
        <SectionHeading overline="Inbound" title="Vouching for you" count={counts.pizzadaoFollowers} />
        {filteredInbound.length > 0
          ? grid(filteredInbound, false)
          : inbound.length === 0
          ? (
            <EmptyState title="Nobody has vouched for you yet">
              Build your reputation — ask a few members to vouch for you on their profile.
            </EmptyState>
          )
          : <EmptyState title="No vouchers match your search." />}
      </section>

      {/* You vouch for (outbound) */}
      <section>
        <SectionHeading overline="Outbound" title="You vouch for" count={counts.pizzadao} />
        {filteredOutbound.length > 0
          ? grid(filteredOutbound, true)
          : outbound.length === 0
          ? (
            <EmptyState title="You haven't vouched for anyone yet">
              Visit a member profile and tap “+ Vouch” to add one.
            </EmptyState>
          )
          : <EmptyState title="No vouches match your search." />}
      </section>

      {/* Footer */}
      <div className="rule-warm mt-12 pt-4 text-center">
        <p className="overline m-0 text-foreground/40">§ pizzadao · est. 2021</p>
      </div>
    </EditorialPage>
  );
}
