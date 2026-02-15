"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type FriendSummary = {
  memberId: string;
  name: string;
  city: string;
};

type FriendsWidgetProps = {
  memberId: string;
};

export function FriendsWidget({ memberId }: FriendsWidgetProps) {
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/friends?memberId=${encodeURIComponent(memberId)}&limit=5`
        );
        if (res.ok) {
          const data = await res.json();
          setFriends(
            (data.friends || []).map((f: any) => ({
              memberId: f.memberId,
              name: f.name || "Unknown",
              city: f.city || "",
            }))
          );
          setTotal(data.counts?.total || 0);
        }
      } catch {
        // Silently fail
      } finally {
        setLoaded(true);
      }
    })();
  }, [memberId]);

  if (!loaded) return null;

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        marginTop: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <h3
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "1px",
            opacity: 0.5,
            margin: 0,
            fontWeight: 700,
          }}
        >
          Friends in the DAO
          {total > 0 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                opacity: 0.8,
              }}
            >
              ({total})
            </span>
          )}
        </h3>
        {total > 0 && (
          <Link
            href="/friends"
            style={{
              fontSize: 13,
              fontWeight: 650,
              color: "var(--color-accent)",
              textDecoration: "none",
            }}
          >
            View All
          </Link>
        )}
      </div>

      {friends.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {friends.map((f) => (
            <Link
              key={f.memberId}
              href={`/profile/${f.memberId}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                textDecoration: "none",
                color: "inherit",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.borderColor =
                  "var(--color-border-strong)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.borderColor = "var(--color-border)")
              }
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                }}
              >
                {f.name}
              </span>
              {f.city && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                  }}
                >
                  {f.city}
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: 16,
            borderRadius: 10,
            border: "1px dashed var(--color-border)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-muted)",
              margin: 0,
            }}
          >
            No friends yet. Visit member profiles to follow them!
          </p>
          <Link
            href="/friends"
            style={{
              display: "inline-block",
              marginTop: 8,
              fontSize: 13,
              fontWeight: 650,
              color: "var(--color-accent)",
              textDecoration: "none",
            }}
          >
            Find Friends
          </Link>
        </div>
      )}
    </div>
  );
}
