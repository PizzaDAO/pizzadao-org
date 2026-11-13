"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyTokenProps {
  /** Short label shown before the value, e.g. "HEX", "RGB", "VAR" */
  label: string;
  /** The value users see and what gets copied */
  value: string;
  /** Visual variant - light text on dark surface vs dark on light */
  tone?: "dark" | "light";
}

/**
 * Inline copyable token. Click anywhere on the row to copy `value`
 * to the clipboard; a tiny check icon confirms.
 */
const CopyToken = ({ label, value, tone = "dark" }: CopyTokenProps) => {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  const onLight = tone === "light";
  const labelClr = onLight ? "text-ink/45" : "text-cream/55";
  const valueClr = onLight ? "text-ink/85" : "text-cream/90";
  const hover = onLight ? "hover:bg-ink/5" : "hover:bg-cream/10";
  const ring = onLight ? "ring-ink/10" : "ring-cream/15";

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy ${label} ${value}`}
      className={`group inline-flex items-center gap-2 rounded-md px-2 py-1 text-left ring-1 ring-inset transition-colors ${ring} ${hover}`}
    >
      <span
        className={`ui text-[9px] font-semibold uppercase tracking-[0.2em] ${labelClr}`}
      >
        {label}
      </span>
      <span className={`ui text-[11px] font-mono tracking-tight ${valueClr}`}>
        {value}
      </span>
      <span
        className={`ml-1 flex h-3.5 w-3.5 items-center justify-center ${valueClr} opacity-60 group-hover:opacity-100`}
      >
        {copied ? (
          <Check className="h-3 w-3" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </span>
      {copied && (
        <span className={`ui text-[9px] font-semibold uppercase tracking-[0.2em] ${valueClr}`}>
          Copied
        </span>
      )}
    </button>
  );
};

/** Convert "#F83A3A" → "rgb(248, 58, 58)" */
export const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h,
    16,
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgb(${r}, ${g}, ${b})`;
};

/** "Sea Glass" → "--color-sea-glass" */
export const cssVarName = (name: string) =>
  `--color-${name.toLowerCase().replace(/\s+/g, "-")}`;

export default CopyToken;
