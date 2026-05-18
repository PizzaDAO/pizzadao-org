"use client";

import React, { useState, useEffect } from "react";
import { card } from "../shared-styles";

type InventoryItem = {
  itemId: number;
  name: string;
  description: string | null;
  quantity: number;
};

export function InventoryList() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchInventory = async () => {
      try {
        const res = await fetch("/api/inventory");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch inventory");
        setItems(data.inventory);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchInventory();
  }, []);

  const heading = (
    <h2
      style={{
        fontSize: 20,
        fontWeight: 700,
        marginBottom: 16,
        marginTop: 0,
        fontFamily:
          "var(--font-display), var(--font-sans), system-ui, sans-serif",
        letterSpacing: "-0.01em",
        color: "hsl(var(--foreground))",
      }}
    >
      Your Inventory
    </h2>
  );

  if (loading) {
    return (
      <div style={card()}>
        {heading}
        <div style={{ display: "grid", gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              style={{
                height: 48,
                background: "hsl(var(--muted))",
                borderRadius: "var(--radius)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          ...card(),
          background: "hsl(var(--tomato) / 0.06)",
          borderColor: "hsl(var(--tomato) / 0.30)",
        }}
      >
        <p style={{ color: "hsl(var(--tomato))", margin: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={card()}>
      {heading}

      {items.length === 0 ? (
        <p
          style={{
            color: "hsl(var(--muted-foreground))",
            textAlign: "center",
            padding: "24px 0",
            margin: 0,
          }}
        >
          Your inventory is empty. Visit the shop to buy items!
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.itemId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                background: "hsl(var(--cream-warm))",
                border: "1px solid hsl(var(--rule) / 0.12)",
                borderRadius: "var(--radius)",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3
                  style={{
                    fontWeight: 600,
                    margin: 0,
                    fontSize: 14,
                    color: "hsl(var(--foreground))",
                  }}
                >
                  {item.name}
                </h3>
                {item.description && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "hsl(var(--muted-foreground))",
                      margin: "2px 0 0",
                    }}
                  >
                    {item.description}
                  </p>
                )}
              </div>
              <span
                style={{
                  fontWeight: 700,
                  color: "hsl(var(--tomato))",
                  fontFamily:
                    "var(--font-display), var(--font-sans), system-ui, sans-serif",
                  fontSize: 16,
                }}
              >
                ×{item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
