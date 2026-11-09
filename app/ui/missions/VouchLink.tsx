"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { publicProfileUrl } from "../vouches/share-profile";
import { ShareProfileButton } from "../vouches/ShareProfileButton";
import { AskForVouches } from "../vouches/AskForVouches";

type Props = {
  /** The signed-in member's own id. */
  memberId: string;
  /** Vouches received so far / needed (omitted `have`: no progress line). */
  have?: number;
  need: number;
};

const BTN_STYLE = {
  minHeight: 44,
  minWidth: 44,
  padding: "0 1rem",
  background: "hsl(var(--ink))",
  color: "hsl(var(--cream))",
  border: "1px solid transparent",
  cursor: "pointer",
} as const;

/** "Get vouched by N members": the member's public vouch link, with copy, share and progress. */
export function VouchLink({ memberId, have, need }: Props) {
  const t = useTranslations("missionLinks.vouch");
  const [url, setUrl] = useState(() => publicProfileUrl(memberId, ""));
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setUrl(publicProfileUrl(memberId, window.location.origin));
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [memberId]);

  async function copy() {
    let result: "copied" | "failed" = "failed";
    try {
      await navigator.clipboard.writeText(url);
      result = "copied";
    } catch {}
    setCopied(result);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied("idle"), 2000);
  }

  return (
    <div
      data-testid="mission-vouch-link"
      style={{
        marginTop: 10,
        padding: "8px 10px",
        background: "hsl(var(--butter) / 0.15)",
        borderLeft: "2px solid hsl(var(--butter))",
        borderRadius: 4,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="overline" style={{ color: "hsl(var(--ink) / 0.7)" }}>
          § {t("title")}
        </span>
        {have !== undefined && (
          <strong data-testid="mission-vouch-progress">{t("progress", { have, need })}</strong>
        )}
      </div>
      <code data-testid="mission-vouch-url" style={{ display: "block", wordBreak: "break-all", margin: "6px 0" }}>{url}</code>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn-pill" onClick={copy} style={BTN_STYLE}>
          {copied === "copied" ? t("copied") : t("copy")}
        </button>
        <ShareProfileButton
          memberId={memberId}
          label={t("share")}
          text={t("shareText")}
          copiedLabel={t("shareCopied")}
          failedLabel={t("copyFailed")}
          className="btn-pill min-h-11 border border-foreground/20"
        />
        {copied === "failed" && <span role="status" className="ui text-[13px]">{t("copyFailed")}</span>}
      </div>
      <AskForVouches memberId={memberId} showShare={false} compact />
    </div>
  );
}
