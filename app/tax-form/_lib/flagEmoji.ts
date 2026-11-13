// Ported from rsv-pizza@f04ad2a1 frontend/src/lib/iso4217.ts (flagEmoji only; pure regional-indicator math).
const GLOBE = '🌐';

export function flagEmoji(cc: string): string {
  if (!cc || cc.length !== 2) return GLOBE;
  const upper = cc.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return GLOBE;
  const base = 0x1f1e6; // regional indicator 'A'
  const a = upper.charCodeAt(0) - 65;
  const b = upper.charCodeAt(1) - 65;
  return String.fromCodePoint(base + a, base + b);
}
