"use client";

import React, { useState, useEffect } from "react";
import { ShopItem } from "./ShopItem";

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

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

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

  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ height: 120, background: "rgba(0,0,0,0.04)", borderRadius: 14 }} />
        ))}
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

  if (items.length === 0) {
    return (
      <div style={{ ...card(), textAlign: "center" }}>
        <p style={{ opacity: 0.5 }}>No items available in the shop</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
      {items.map((item) => (
        <ShopItem key={item.id} item={item} onPurchase={handlePurchase} />
      ))}
    </div>
  );
}
