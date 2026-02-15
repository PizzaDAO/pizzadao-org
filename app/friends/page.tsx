"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import { FriendCard } from "../ui/friends/FriendCard";
import { SocialAccountLinker } from "../ui/friends/SocialAccountLinker";

const inter = Inter({ subsets: ["latin"] });

type FriendData = {
  memberId: string;
  name: string;
  city: string;
  crews: string;
  source: "PIZZADAO" | "TWITTER" | "FARCASTER";
};

type FilterTab = "ALL" | "PIZZADAO" | "FARCASTER" | "TWITTER";

export default function FriendsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendData[]>([]);
  const [counts, setCounts] = useState({
    total: 0,
    pizzadao: 0,
    farcaster: 0,
    twitter: 0,
    followers: 0,
  });
  const [activeTab, setActiveTab] = useState<FilterTab>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Auth check and data load
  useEffect(() => {
    (async () => {
      try {
        // Get current user's memberId via the /api/me endpoint or member-lookup
        const meRes = await fetch("/api/me");
        if (!meRes.ok) {
          setAuthError("Please log in to view your friends");
          setLoading(false);
          return;
        }
        const meData = await meRes.json();
        const myMemberId = meData.memberId;

        if (!myMemberId) {
          setAuthError("Could not find your member profile");
          setLoading(false);
          return;
        }

        setMemberId(myMemberId);

        // Fetch friends
        const friendsRes = await fetch(
          `/api/friends?memberId=${encodeURIComponent(myMemberId)}&limit=200`
        );
        if (friendsRes.ok) {
          const data = await friendsRes.json();
          setFriends(data.friends || []);
          setCounts(
            data.counts || {
              total: 0,
              pizzadao: 0,
              farcaster: 0,
              twitter: 0,
              followers: 0,
            }
          );
        }
      } catch (err) {
        console.error("Failed to load friends:", err);
        setAuthError("Failed to load friends page");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleRemove = async (targetMemberId: string) => {
    setRemovingId(targetMemberId);
    try {
      const res = await fetch("/api/friends/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetMemberId }),
      });

      if (res.ok) {
        setFriends((prev) =>
          prev.filter((f) => f.memberId !== targetMemberId)
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

  // Filter friends
  const filteredFriends = friends.filter((f) => {
    if (activeTab !== "ALL" && f.source !== activeTab) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        f.name.toLowerCase().includes(q) ||
        f.city.toLowerCase().includes(q) ||
        f.crews.toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-page-bg)",
          color: "var(--color-text)",
          fontFamily: inter.style.fontFamily,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 50,
              height: 50,
              border: "4px solid var(--color-spinner-track)",
              borderTop: "4px solid var(--color-spinner-active)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 20px",
            }}
          />
          <p style={{ fontSize: 18, opacity: 0.8 }}>Loading friends...</p>
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
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-page-bg)",
          color: "var(--color-text)",
          fontFamily: inter.style.fontFamily,
          padding: 20,
        }}
      >
        <div style={cardStyle()}>
          <h1 style={{ fontSize: 24, marginBottom: 16 }}>
            Friends in the DAO
          </h1>
          <p style={{ opacity: 0.7, marginBottom: 32 }}>{authError}</p>
          <Link href="/" style={btnStyle("primary")}>
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
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-page-bg)",
        color: "var(--color-text)",
        fontFamily: inter.style.fontFamily,
        padding: "40px 20px",
      }}
    >
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
              fontSize: 16,
              fontWeight: 600,
              color: "var(--color-text-secondary)",
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
              fontSize: 32,
              marginBottom: 8,
              fontWeight: 800,
            }}
          >
            Friends in the DAO
          </h1>
          <p
            style={{
              fontSize: 16,
              color: "var(--color-text-secondary)",
              margin: 0,
            }}
          >
            {counts.total} following &middot; {counts.followers} followers
          </p>
        </header>

        {/* Social Account Linking */}
        {memberId && (
          <div style={cardStyle()}>
            <SocialAccountLinker memberId={memberId} />
          </div>
        )}

        {/* Filter Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 4,
            borderRadius: 12,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: 8,
                border: "none",
                background:
                  activeTab === tab.id
                    ? "var(--color-btn-primary-bg)"
                    : "transparent",
                color:
                  activeTab === tab.id
                    ? "var(--color-btn-primary-text)"
                    : "var(--color-text-secondary)",
                fontSize: 13,
                fontWeight: 650,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{ marginLeft: 4, opacity: 0.7 }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search friends by name, city, or crew..."
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid var(--color-input-border)",
            fontSize: 14,
            outline: "none",
            boxSizing: "border-box",
            background: "var(--color-input-bg)",
            color: "var(--color-input-text)",
            fontFamily: "inherit",
          }}
        />

        {/* Friends Grid */}
        {filteredFriends.length > 0 ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {filteredFriends.map((f) => (
              <FriendCard
                key={f.memberId}
                memberId={f.memberId}
                name={f.name}
                city={f.city}
                crews={f.crews}
                source={f.source}
                isOwnList={true}
                onRemove={handleRemove}
              />
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: 40,
              borderRadius: 14,
              border: "1px dashed var(--color-border)",
              textAlign: "center",
            }}
          >
            {friends.length === 0 ? (
              <>
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    marginBottom: 8,
                    color: "var(--color-text-primary)",
                  }}
                >
                  No friends yet
                </p>
                <p
                  style={{
                    fontSize: 14,
                    color: "var(--color-text-muted)",
                    marginBottom: 16,
                  }}
                >
                  Visit member profiles to follow them, or link your social
                  accounts to find friends.
                </p>
              </>
            ) : (
              <p
                style={{
                  fontSize: 14,
                  color: "var(--color-text-muted)",
                }}
              >
                No friends match your search.
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            marginTop: 40,
            opacity: 0.4,
            fontSize: 13,
          }}
        >
          PizzaDAO
        </div>
      </div>
    </div>
  );
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--color-border)",
    borderRadius: 14,
    padding: 24,
    boxShadow: "var(--shadow-card)",
    background: "var(--color-surface)",
    display: "grid",
    gap: 14,
  };
}

function btnStyle(kind: "primary" | "secondary"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid var(--color-border-strong)",
    fontWeight: 650,
    cursor: "pointer",
    textDecoration: "none",
    textAlign: "center",
    fontFamily: "inherit",
  };
  if (kind === "primary")
    return {
      ...base,
      background: "var(--color-btn-primary-bg)",
      color: "var(--color-btn-primary-text)",
      borderColor: "var(--color-btn-primary-border)",
    };
  return {
    ...base,
    background: "var(--color-surface)",
    color: "var(--color-text)",
  };
}
