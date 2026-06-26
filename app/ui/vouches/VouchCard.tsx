"use client";

import Link from "next/link";

type VouchCardProps = {
  memberId: string;
  name: string;
  city: string;
  crews: string;
  source: "PIZZADAO" | "TWITTER" | "FARCASTER";
  isOwnList: boolean;
  onRemove?: (memberId: string) => void;
};

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

// Source -> token-based pill style. PIZZADAO uses tomato (brand accent),
// the social sources use butter so they sit warmly next to the brand chip.
function sourceBadge(
  source: VouchCardProps["source"]
): { label: string; style: React.CSSProperties } {
  if (source === "PIZZADAO") {
    return {
      label: "PizzaDAO",
      style: {
        background: "hsl(var(--tomato) / 0.12)",
        color: "hsl(var(--tomato))",
        border: "1px solid hsl(var(--tomato) / 0.30)",
      },
    };
  }
  if (source === "FARCASTER") {
    return {
      label: "Farcaster",
      style: {
        background: "hsl(var(--butter) / 0.30)",
        color: "hsl(var(--foreground))",
        border: "1px solid hsl(var(--butter) / 0.60)",
      },
    };
  }
  return {
    label: "X",
    style: {
      background: "hsl(var(--muted))",
      color: "hsl(var(--foreground))",
      border: "1px solid hsl(var(--rule) / 0.22)",
    },
  };
}

export function VouchCard({
  memberId,
  name,
  city,
  crews,
  source,
  isOwnList,
  onRemove,
}: VouchCardProps) {
  const badge = sourceBadge(source);

  return (
    <div
      style={{
        padding: 16,
        borderRadius: "var(--radius)",
        border: "1px solid hsl(var(--rule) / 0.12)",
        background: "hsl(var(--card))",
        color: "hsl(var(--card-foreground))",
        display: "grid",
        gap: 8,
        transition: "box-shadow 150ms ease, border-color 150ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 8px 30px hsl(var(--ink) / 0.12)";
        e.currentTarget.style.borderColor = "hsl(var(--rule) / 0.22)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.borderColor = "hsl(var(--rule) / 0.12)";
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link
            href={`/profile/${memberId}`}
            style={{
              fontFamily: displayFont,
              fontSize: 16,
              fontWeight: 700,
              color: "hsl(var(--foreground))",
              textDecoration: "none",
              letterSpacing: "-0.005em",
              // sicilian-41551: long single-word mafia names shouldn't shove
              // the source badge off the right edge of a 240-px card.
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "hsl(var(--tomato))";
              e.currentTarget.style.textDecoration = "underline";
              e.currentTarget.style.textUnderlineOffset = "2px";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "hsl(var(--foreground))";
              e.currentTarget.style.textDecoration = "none";
            }}
          >
            {name}
          </Link>
          {city && (
            <p
              style={{
                fontSize: 13,
                color: "hsl(var(--muted-foreground))",
                margin: "2px 0 0",
              }}
            >
              {city}
            </p>
          )}
        </div>
        <span
          style={{
            ...badge.style,
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            flexShrink: 0,
            fontFamily: "var(--font-sans), system-ui, sans-serif",
          }}
        >
          {badge.label}
        </span>
      </div>

      {crews && crews !== "None" && (
        <p
          style={{
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
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
            color: "hsl(var(--muted-foreground))",
            background: "none",
            border: "none",
            cursor: "pointer",
            // sicilian-41551: bump tap area to 44px tall while keeping the
            // visual look (negative inset margin so layout doesn't shift).
            padding: "10px 12px",
            margin: "-10px -12px",
            minHeight: 44,
            display: "inline-flex",
            alignItems: "center",
            fontFamily: "inherit",
            transition: "color 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "hsl(var(--tomato))";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "hsl(var(--muted-foreground))";
          }}
        >
          Unvouch
        </button>
      )}
    </div>
  );
}
