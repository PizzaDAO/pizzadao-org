"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type VouchSummary = {
  memberId: string;
  name: string;
  city: string;
};

type VouchesWidgetProps = {
  memberId: string;
};

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

export function VouchesWidget({ memberId }: VouchesWidgetProps) {
  const [vouches, setVouches] = useState<VouchSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/vouches?memberId=${encodeURIComponent(memberId)}&limit=5`
        );
        if (res.ok) {
          const data = await res.json();
          setVouches(
            (data.vouches || []).map((v: any) => ({
              memberId: v.memberId,
              name: v.name || "Unknown",
              city: v.city || "",
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
            fontFamily: displayFont,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "hsl(var(--muted-foreground))",
            margin: 0,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          Vouches
          {total > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "hsl(var(--butter) / 0.35)",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--butter) / 0.60)",
                padding: "2px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0,
                textTransform: "none",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {total}
            </span>
          )}
        </h3>
        {total > 0 && (
          <Link
            href="/vouches"
            style={{
              fontFamily: displayFont,
              fontSize: 13,
              fontWeight: 700,
              color: "hsl(var(--tomato))",
              textDecoration: "none",
              textUnderlineOffset: 2,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.textDecoration = "underline";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.textDecoration = "none";
            }}
          >
            View All
          </Link>
        )}
      </div>

      {vouches.length > 0 ? (
        <div style={{ display: "grid", gap: 6 }}>
          {vouches.map((v) => (
            <Link
              key={v.memberId}
              href={`/profile/${v.memberId}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                borderRadius: "var(--radius)",
                border: "1px solid hsl(var(--rule) / 0.12)",
                background: "hsl(var(--card))",
                color: "hsl(var(--card-foreground))",
                textDecoration: "none",
                transition: "border-color 150ms ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor =
                  "hsl(var(--rule) / 0.22)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor =
                  "hsl(var(--rule) / 0.12)";
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "hsl(var(--foreground))",
                }}
              >
                {v.name}
              </span>
              {v.city && (
                <span
                  style={{
                    fontSize: 12,
                    color: "hsl(var(--muted-foreground))",
                  }}
                >
                  {v.city}
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: 16,
            borderRadius: "var(--radius)",
            border: "1px dashed hsl(var(--rule) / 0.22)",
            background: "hsl(var(--card))",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 14,
              color: "hsl(var(--muted-foreground))",
              margin: 0,
            }}
          >
            No vouches yet. Visit member profiles to vouch for them!
          </p>
          <Link
            href="/vouches"
            style={{
              display: "inline-block",
              marginTop: 8,
              fontFamily: displayFont,
              fontSize: 13,
              fontWeight: 700,
              color: "hsl(var(--tomato))",
              textDecoration: "none",
              textUnderlineOffset: 2,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.textDecoration = "underline";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.textDecoration = "none";
            }}
          >
            Find Vouches
          </Link>
        </div>
      )}
    </div>
  );
}
