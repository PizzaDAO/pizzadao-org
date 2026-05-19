"use client";

// app/ui/economy/PepIcon.tsx
//
// anchovy-67435 (Restyle Phase 4d): PepIcon is a raster (PNG) Next.js
// <Image>, so there are no fills to theme via currentColor. Kept unchanged
// functionally; this comment is for traceability with the Phase 4d PR.
// See plans/site-restyle-pizzadao-org.md.

import React from "react";
import Image from "next/image";

type PepIconProps = {
  size?: number;
  style?: React.CSSProperties;
};

export function PepIcon({ size = 16, style }: PepIconProps) {
  return (
    <Image
      src="/pep-icon.png"
      alt="PEP"
      width={size}
      height={size}
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        ...style,
      }}
    />
  );
}

type PepAmountProps = {
  amount: number | string;
  size?: number;
  style?: React.CSSProperties;
};

export function PepAmount({ amount, size = 16, style }: PepAmountProps) {
  const displayAmount = typeof amount === "number" ? amount.toLocaleString() : amount;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, ...style }}>
      <PepIcon size={size} />
      <span>{displayAmount}</span>
    </span>
  );
}
