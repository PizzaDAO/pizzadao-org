"use client";

import Link from "next/link";

type FriendCardProps = {
  memberId: string;
  name: string;
  city: string;
  crews: string;
  source: "PIZZADAO" | "TWITTER" | "FARCASTER";
  isOwnList: boolean;
  onRemove?: (memberId: string) => void;
};

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  PIZZADAO: { label: "PizzaDAO", color: "var(--color-accent)" },
  TWITTER: { label: "X", color: "#1DA1F2" },
  FARCASTER: { label: "Farcaster", color: "#8A63D2" },
};

export function FriendCard({
  memberId,
  name,
  city,
  crews,
  source,
  isOwnList,
  onRemove,
}: FriendCardProps) {
  const sourceInfo = SOURCE_LABELS[source] || SOURCE_LABELS.PIZZADAO;

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        display: "grid",
        gap: 8,
        transition: "box-shadow 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "var(--shadow-elevated)";
        e.currentTarget.style.borderColor = "var(--color-border-strong)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.borderColor = "var(--color-border)";
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link
            href={`/profile/${memberId}`}
            style={{
              fontSize: 16,
              fontWeight: 650,
              color: "var(--color-text-primary)",
              textDecoration: "none",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.textDecoration = "underline")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.textDecoration = "none")
            }
          >
            {name}
          </Link>
          {city && (
            <p
              style={{
                fontSize: 13,
                color: "var(--color-text-secondary)",
                margin: "2px 0 0",
              }}
            >
              {city}
            </p>
          )}
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 6,
            background: `${sourceInfo.color}18`,
            color: sourceInfo.color,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {sourceInfo.label}
        </span>
      </div>

      {crews && crews !== "None" && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-text-muted)",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {crews}
        </p>
      )}

      {isOwnList && source === "PIZZADAO" && onRemove && (
        <button
          onClick={() => onRemove(memberId)}
          style={{
            alignSelf: "start",
            fontSize: 12,
            color: "var(--color-text-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--color-danger)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--color-text-muted)")
          }
        >
          Unfollow
        </button>
      )}
    </div>
  );
}
