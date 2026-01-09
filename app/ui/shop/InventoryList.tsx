"use client";

import React, { useState, useEffect } from "react";

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

  if (loading) {
    return (
      <div className="p-6 bg-gray-800 rounded-lg">
        <h2 className="text-xl font-bold mb-4">Your Inventory</h2>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-700 rounded animate-pulse"></div>
          ))}
        </div>
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

  return (
    <div className="p-6 bg-gray-800 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Your Inventory</h2>

      {items.length === 0 ? (
        <p className="text-gray-400 text-center py-8">
          Your inventory is empty. Visit the shop to buy items!
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.itemId}
              className="flex items-center justify-between p-3 bg-gray-700 rounded"
            >
              <div>
                <h3 className="font-medium">{item.name}</h3>
                {item.description && (
                  <p className="text-sm text-gray-400">{item.description}</p>
                )}
              </div>
              <span className="text-lg font-bold text-blue-400">
                x{item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
