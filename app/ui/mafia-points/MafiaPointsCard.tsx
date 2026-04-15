"use client";

import { useEffect, useState } from "react";
import type { MafiaPointsResult, PointBreakdown } from "@/app/lib/mafia-points";

interface Props {
  memberId: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  discord_role: "Discord Roles",
  nft: "NFTs",
  poap: "POAPs",
  attendance: "Attendance",
};

const CATEGORY_ORDER = ["discord_role", "nft", "poap", "attendance"];

export function MafiaPointsCard({ memberId }: Props) {
  const [data, setData] = useState<MafiaPointsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetchPoints() {
      try {
        const res = await fetch(`/api/mafia-points/${memberId}`);
        if (res.ok) {
          const json: MafiaPointsResult = await res.json();
          setData(json);
        }
      } catch {
        // silently fail — supplementary info
      } finally {
        setLoading(false);
      }
    }
    if (memberId) fetchPoints();
  }, [memberId]);

  if (loading || !data || data.totalPoints === 0) return null;

  // Group breakdown by category
  const grouped = new Map<string, PointBreakdown[]>();
  for (const item of data.breakdown) {
    const list = grouped.get(item.category) || [];
    list.push(item);
    grouped.set(item.category, list);
  }

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>
        Mafia Points
      </h3>

      {/* Total — big number */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 20,
          padding: 16,
          borderRadius: 12,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 800,
            lineHeight: 1,
            color: "var(--color-text)",
          }}
        >
          {data.totalPoints.toLocaleString()}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 1,
            opacity: 0.5,
            marginTop: 6,
          }}
        >
          Total Points
        </div>
      </div>

      {/* Category summary chips */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: expanded ? 16 : 0,
        }}
      >
        {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
          const items = grouped.get(cat)!;
          const catTotal = items.reduce((s, i) => s + i.total, 0);
          return (
            <div
              key={cat}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span style={{ opacity: 0.6 }}>
                {CATEGORY_LABELS[cat] || cat}
              </span>{" "}
              {catTotal.toLocaleString()}
            </div>
          );
        })}
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "none",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            color: "var(--color-text)",
            opacity: 0.5,
          }}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {/* Expanded breakdown */}
      {expanded && (
        <div style={{ display: "grid", gap: 12 }}>
          {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
            const items = grouped.get(cat)!;
            return (
              <div key={cat}>
                <h4
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                    opacity: 0.5,
                    marginTop: 0,
                    marginBottom: 8,
                    fontWeight: 700,
                  }}
                >
                  {CATEGORY_LABELS[cat] || cat}
                </h4>
                <div style={{ display: "grid", gap: 4 }}>
                  {items.map((item, idx) => (
                    <div
                      key={item.sourceId}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "6px 10px",
                        borderRadius: 8,
                        background:
                          idx % 2 === 0
                            ? "transparent"
                            : "var(--color-surface)",
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>
                        {item.label}
                        {item.quantity > 1 && (
                          <span style={{ opacity: 0.5 }}>
                            {" "}
                            x{item.quantity}
                          </span>
                        )}
                      </span>
                      <span style={{ fontWeight: 700 }}>
                        {item.total.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
