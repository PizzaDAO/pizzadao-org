"use client";

import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { publicProfileUrl, shareOrCopy } from "./share-profile";

type Props = {
  memberId: string;
  /** Button label. */
  label: string;
  /** Message shared with the link, e.g. "Vouch for me on PizzaDAO:". */
  text: string;
  copiedLabel: string;
  failedLabel: string;
  className?: string;
};

/** Shares the member's PUBLIC profile link with a short message (Web Share API, copy fallback). */
export function ShareProfileButton({ memberId, label, text, copiedLabel, failedLabel, className }: Props) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function onClick() {
    const url = publicProfileUrl(memberId, window.location.origin);
    const result = await shareOrCopy({ text, url });
    if (result === "copied" || result === "failed") {
      setStatus(result);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), 2400);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={className ?? "btn-pill"}
        style={className ? undefined : { background: "hsl(var(--tomato))", color: "hsl(var(--cream))", border: "none", cursor: "pointer" }}
      >
        <Share2 size={14} aria-hidden />
        {label}
      </button>
      <span role="status" aria-live="polite" className="ui text-[13px] text-foreground/70">
        {status === "copied" ? copiedLabel : status === "failed" ? failedLabel : ""}
      </span>
    </>
  );
}
