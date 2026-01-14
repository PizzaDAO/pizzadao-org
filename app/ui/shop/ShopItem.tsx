"use client";

import React, { useState } from "react";
import { PepAmount } from "../economy/PepIcon";

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

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

function input(): React.CSSProperties {
  return {
    width: 50,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1px solid rgba(0,0,0,0.18)",
    fontSize: 14,
    textAlign: "center" as const,
    outline: "none",
  };
}

function btn(disabled?: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "black",
    color: "white",
    fontSize: 13,
  };
}

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
    <div style={card()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <h3 style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>{item.name}</h3>
        <span style={{ fontWeight: 700, color: "#16a34a" }}><PepAmount amount={item.price} size={14} /></span>
      </div>

      {item.description && (
        <p style={{ fontSize: 13, color: "#666", marginBottom: 12, marginTop: 0 }}>{item.description}</p>
      )}

      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
        {item.quantity === -1 ? "Unlimited stock" : `${item.quantity} in stock`}
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 8, background: "rgba(255,0,0,0.05)", borderRadius: 6, color: "#c00", fontSize: 12 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ marginBottom: 12, padding: 8, background: "rgba(0,200,0,0.08)", borderRadius: 6, color: "#16a34a", fontSize: 12 }}>
          Purchase successful!
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          min="1"
          max={item.quantity === -1 ? 999 : item.quantity}
          style={input()}
          disabled={loading || !item.inStock}
        />
        <button
          onClick={handleBuy}
          disabled={loading || !item.inStock}
          style={btn(loading || !item.inStock)}
        >
          {loading ? "Buying..." : item.inStock ? "Buy" : "Out of Stock"}
        </button>
      </div>
    </div>
  );
}
