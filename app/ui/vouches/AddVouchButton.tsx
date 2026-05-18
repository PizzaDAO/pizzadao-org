"use client";

import { useState, useEffect } from "react";

type AddVouchButtonProps = {
  targetMemberId: string;
  currentMemberId?: string | null;
};

/**
 * Profile hero CTA: "+ Vouch" / "Vouched" toggle.
 *
 * Phase 3c restyle: tomato accent button when not vouched (the loud brand
 * CTA), outlined cream-pill when already vouched. Reads correctly on the
 * ink hero — both states use cream/tomato that pop against dark ink.
 * Hover-on-vouched turns destructive-red and swaps the label to "Unvouch".
 */
export function AddVouchButton({
  targetMemberId,
  currentMemberId,
}: AddVouchButtonProps) {
  const [isVouched, setIsVouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const shouldShow = !!currentMemberId && currentMemberId !== targetMemberId;

  // Check if already vouched on mount
  useEffect(() => {
    if (!shouldShow) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/vouches?memberId=${encodeURIComponent(currentMemberId!)}&limit=200`,
        );
        if (res.ok) {
          const data = await res.json();
          const vouched = data.vouches?.some(
            (v: any) => v.memberId === targetMemberId,
          );
          setIsVouched(!!vouched);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    })();
  }, [currentMemberId, targetMemberId, shouldShow]);

  // Don't show if viewing own profile or not authenticated
  if (!shouldShow || loading) {
    return null;
  }

  const handleToggle = async () => {
    setActionLoading(true);
    try {
      const endpoint = isVouched ? "/api/vouches/remove" : "/api/vouches/add";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetMemberId }),
      });

      if (res.ok) {
        setIsVouched(!isVouched);
      } else {
        const data = await res.json();
        // If already vouched and we tried to add, just set the state
        if (res.status === 409) {
          setIsVouched(true);
        } else {
          console.error("Vouch action failed:", data.error);
        }
      }
    } catch (err) {
      console.error("Vouch action error:", err);
    } finally {
      setActionLoading(false);
    }
  };

  // Vouched state: outlined cream pill on dark hero
  // Not-vouched state: solid tomato CTA
  const baseClass =
    "inline-flex items-center gap-1.5 px-4 py-2 rounded-[--radius] text-sm font-semibold font-display transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-ink";

  if (isVouched) {
    return (
      <button
        onClick={handleToggle}
        disabled={actionLoading}
        className={`${baseClass} bg-transparent border border-cream/30 text-cream hover:border-tomato hover:bg-tomato hover:text-cream cursor-pointer disabled:cursor-wait disabled:opacity-60`}
        onMouseEnter={(e) => {
          if (!actionLoading) e.currentTarget.textContent = "Unvouch";
        }}
        onMouseLeave={(e) => {
          if (!actionLoading) e.currentTarget.textContent = "Vouched";
        }}
      >
        {actionLoading ? "..." : "Vouched"}
      </button>
    );
  }

  return (
    <button
      onClick={handleToggle}
      disabled={actionLoading}
      className={`${baseClass} bg-tomato text-cream border border-tomato hover:bg-tomato-deep hover:border-tomato-deep cursor-pointer disabled:cursor-wait disabled:opacity-60`}
    >
      {actionLoading ? "..." : "+ Vouch"}
    </button>
  );
}
