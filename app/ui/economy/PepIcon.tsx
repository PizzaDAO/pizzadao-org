"use client";

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
