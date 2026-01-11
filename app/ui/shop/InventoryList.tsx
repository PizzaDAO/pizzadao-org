"use client";

import React, { useState, useEffect } from "react";

type InventoryItem = {
  itemId: number;
  name: string;
  description: string | null;
  quantity: number;
};

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

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

  if (loading) {
    return (
      <div style={card()}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Your Inventory</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ height: 48, background: "rgba(0,0,0,0.04)", borderRadius: 10 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card(), background: "rgba(255,0,0,0.05)", borderColor: "rgba(255,0,0,0.3)" }}>
        <p style={{ color: "#c00" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={card()}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Your Inventory</h2>

      {items.length === 0 ? (
        <p style={{ opacity: 0.5, textAlign: "center", padding: "24px 0" }}>
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
                padding: 12,
                background: "#fafafa",
                borderRadius: 10,
              }}
            >
              <div>
                <h3 style={{ fontWeight: 600, margin: 0, fontSize: 14 }}>{item.name}</h3>
                {item.description && (
                  <p style={{ fontSize: 12, opacity: 0.6, margin: "4px 0 0" }}>{item.description}</p>
                )}
              </div>
              <span style={{ fontWeight: 700, color: "#2563eb" }}>
                x{item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
