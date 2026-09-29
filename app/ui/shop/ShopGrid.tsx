"use client";

import React, { useState, useEffect } from "react";
import { ShopItem } from "./ShopItem";
import { card } from "../shared-styles";

type Item = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  priceFormatted: string;
  quantity: number;
  inStock: boolean;
};

type ShopGridProps = {
  onPurchase?: () => void;
};

export function ShopGrid({ onPurchase }: ShopGridProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = async () => {
    try {
      const res = await fetch("/api/shop");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch shop items");
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handlePurchase = () => {
    fetchItems();
    onPurchase?.();
  };

  // 2-col on small, 3-col mid, 4-col wide per spec.
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 14,
  };

  if (loading) {
    return (
      <div style={gridStyle}>
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            style={{
              height: 180,
              background: "hsl(var(--muted))",
              borderRadius: "var(--radius)",
            }}
          />
        ))}
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

  if (items.length === 0) {
    return (
      <div style={{ ...card(), textAlign: "center" }}>
        <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>
          No items available in the shop
        </p>
      </div>
    );
  }

  return (
    <div style={gridStyle}>
      {items.map((item) => (
        <ShopItem key={item.id} item={item} onPurchase={handlePurchase} />
      ))}
    </div>
  );
}
