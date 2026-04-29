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
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const shouldShow = !!currentMemberId && currentMemberId !== targetMemberId;

  // Check if already following on mount
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
          const following = data.friends?.some(
            (f: any) => f.memberId === targetMemberId
          );
          setIsFollowing(!!following);
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
      const endpoint = isFollowing ? "/api/friends/remove" : "/api/friends/add";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetMemberId }),
      });

      if (res.ok) {
        setIsFollowing(!isFollowing);
      } else {
        const data = await res.json();
        // If already following and we tried to add, just set the state
        if (res.status === 409) {
          setIsFollowing(true);
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
        border: isFollowing
          ? "1px solid var(--color-border-strong)"
          : "1px solid var(--color-btn-primary-border)",
        background: isFollowing
          ? "var(--color-surface)"
          : "var(--color-btn-primary-bg)",
        color: isFollowing
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
        if (isFollowing && !actionLoading) {
          e.currentTarget.style.borderColor = "var(--color-danger)";
          e.currentTarget.style.color = "var(--color-danger)";
          e.currentTarget.textContent = "Unfollow";
        }
      }}
      onMouseLeave={(e) => {
        if (isFollowing && !actionLoading) {
          e.currentTarget.style.borderColor = "var(--color-border-strong)";
          e.currentTarget.style.color = "var(--color-text)";
          e.currentTarget.textContent = "Following";
        }
      }}
    >
      {actionLoading
        ? "..."
        : isFollowing
        ? "Following"
        : "+ Follow"}
    </button>
  );
}
