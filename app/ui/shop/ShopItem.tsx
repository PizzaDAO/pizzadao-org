"use client";

import React, { useState } from "react";
import { PepAmount } from "../economy/PepIcon";
import { card as cardBase, btn, input } from "../shared-styles";

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
    <div
      style={{
        ...cardBase(),
        padding: 0,
        gap: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Image placeholder area (top of card) */}
      <div
        style={{
          aspectRatio: "1 / 1",
          background:
            "linear-gradient(135deg, hsl(var(--butter) / 0.40) 0%, hsl(var(--tomato) / 0.25) 100%)",
          borderTopLeftRadius: "var(--radius)",
          borderTopRightRadius: "var(--radius)",
          borderBottom: "1px solid hsl(var(--rule) / 0.12)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 36,
          color: "hsl(var(--ink) / 0.30)",
          fontFamily:
            "var(--font-display), var(--font-sans), system-ui, sans-serif",
          fontWeight: 700,
          letterSpacing: "0.02em",
        }}
      >
        {item.name.charAt(0).toUpperCase()}
      </div>

      {/* Body */}
      <div
        style={{
          padding: 14,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          gap: 6,
        }}
      >
        <h3
          style={{
            fontWeight: 700,
            fontSize: 16,
            margin: 0,
            fontFamily:
              "var(--font-display), var(--font-sans), system-ui, sans-serif",
            letterSpacing: "-0.01em",
            color: "hsl(var(--foreground))",
          }}
        >
          {item.name}
        </h3>

        {item.description && (
          <p
            style={{
              fontSize: 13,
              color: "hsl(var(--muted-foreground))",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {item.description}
          </p>
        )}

        <div
          style={{
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
            marginTop: "auto",
            paddingTop: 6,
          }}
        >
          {item.quantity === -1
            ? "Unlimited stock"
            : `${item.quantity} in stock`}
        </div>

        {error && (
          <div
            style={{
              padding: 8,
              background: "hsl(var(--tomato) / 0.06)",
              border: "1px solid hsl(var(--tomato) / 0.30)",
              borderRadius: "var(--radius)",
              color: "hsl(var(--tomato))",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              padding: 8,
              background: "hsl(142 71% 35% / 0.10)",
              border: "1px solid hsl(142 71% 35% / 0.35)",
              borderRadius: "var(--radius)",
              color: "hsl(142 71% 28%)",
              fontSize: 12,
            }}
          >
            Purchase successful!
          </div>
        )}
      </div>

      {/* Footer with price + buy */}
      <div
        style={{
          padding: 14,
          borderTop: "1px solid hsl(var(--rule) / 0.12)",
          background: "hsl(var(--cream-warm))",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "hsl(var(--tomato))",
            fontFamily:
              "var(--font-display), var(--font-sans), system-ui, sans-serif",
            letterSpacing: "-0.01em",
            display: "flex",
            alignItems: "center",
          }}
        >
          <PepAmount amount={item.price} size={18} />
        </div>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          min="1"
          max={item.quantity === -1 ? 999 : item.quantity}
          style={{
            ...input(),
            width: 56,
            textAlign: "center",
            padding: "8px 6px",
          }}
          disabled={loading || !item.inStock}
        />
        <button
          onClick={handleBuy}
          disabled={loading || !item.inStock}
          style={{
            ...btn("accent", loading || !item.inStock),
            flex: 1,
            padding: "8px 12px",
            fontSize: 13,
          }}
        >
          {loading ? "Buying..." : item.inStock ? "Buy" : "Out of Stock"}
        </button>
      </div>
    </div>
  );
}
