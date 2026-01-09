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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-40 bg-gray-700 rounded-lg animate-pulse"></div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-500 rounded-lg">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6 bg-gray-800 rounded-lg text-center">
        <p className="text-gray-400">No items available in the shop</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <ShopItem key={item.id} item={item} onPurchase={handlePurchase} />
      ))}
    </div>
  );
}
