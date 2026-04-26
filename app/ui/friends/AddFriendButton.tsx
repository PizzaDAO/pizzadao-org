"use client";

import { useState, useEffect } from "react";

type AddFriendButtonProps = {
  targetMemberId: string;
  currentMemberId?: string | null;
};

export function AddFriendButton({
  targetMemberId,
  currentMemberId,
}: AddFriendButtonProps) {
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
          `/api/friends?memberId=${encodeURIComponent(currentMemberId!)}&limit=200`
        );
        if (res.ok) {
          const data = await res.json();
          const vouched = data.friends?.some(
            (f: any) => f.memberId === targetMemberId
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
      const endpoint = isVouched ? "/api/friends/remove" : "/api/friends/add";
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
          console.error("Friend action failed:", data.error);
        }
      }
    } catch (err) {
      console.error("Friend action error:", err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={actionLoading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 16px",
        borderRadius: 10,
        border: isVouched
          ? "1px solid var(--color-border-strong)"
          : "1px solid var(--color-btn-primary-border)",
        background: isVouched
          ? "var(--color-surface)"
          : "var(--color-btn-primary-bg)",
        color: isVouched
          ? "var(--color-text)"
          : "var(--color-btn-primary-text)",
        fontWeight: 650,
        cursor: actionLoading ? "wait" : "pointer",
        fontSize: 13,
        fontFamily: "inherit",
        opacity: actionLoading ? 0.6 : 1,
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => {
        if (isVouched && !actionLoading) {
          e.currentTarget.style.borderColor = "var(--color-danger)";
          e.currentTarget.style.color = "var(--color-danger)";
          e.currentTarget.textContent = "Remove Vouch";
        }
      }}
      onMouseLeave={(e) => {
        if (isVouched && !actionLoading) {
          e.currentTarget.style.borderColor = "var(--color-border-strong)";
          e.currentTarget.style.color = "var(--color-text)";
          e.currentTarget.textContent = "Vouched";
        }
      }}
    >
      {actionLoading
        ? "..."
        : isVouched
        ? "Vouched"
        : "+ Vouch"}
    </button>
  );
}
