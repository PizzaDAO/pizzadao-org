"use client";

import React, { useState } from "react";

type Item = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  priceFormatted: string;
  quantity: number;
  inStock: boolean;
};

type ShopItemProps = {
  item: Item;
  onPurchase?: () => void;
};

export function ShopItem({ item, onPurchase }: ShopItemProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const handleBuy = async () => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/shop/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, quantity }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess(true);
      setQuantity(1);
      onPurchase?.();

      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-lg">{item.name}</h3>
        <span className="text-green-400 font-bold">{item.priceFormatted}</span>
      </div>

      {item.description && (
        <p className="text-gray-400 text-sm mb-3">{item.description}</p>
      )}

      <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
        <span>
          {item.quantity === -1
            ? "Unlimited stock"
            : `${item.quantity} in stock`}
        </span>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-900/20 border border-red-500 rounded text-red-400 text-xs">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-3 p-2 bg-green-900/20 border border-green-500 rounded text-green-400 text-xs">
          Purchase successful!
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          min="1"
          max={item.quantity === -1 ? 999 : item.quantity}
          className="w-16 px-2 py-1 bg-gray-700 rounded border border-gray-600 text-center"
          disabled={loading || !item.inStock}
        />
        <button
          onClick={handleBuy}
          disabled={loading || !item.inStock}
          className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition"
        >
          {loading ? "Buying..." : item.inStock ? "Buy" : "Out of Stock"}
        </button>
      </div>
    </div>
  );
}
