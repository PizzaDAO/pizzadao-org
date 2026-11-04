"use client";

// L5.3 "Own a Rare Pizza Box": where to get a box, shown on the mission card.

import { useTranslations } from "next-intl";

export function BonusNote() {
  const t = useTranslations("missionLinks");
  return (
    <div data-testid="mission-bonus" style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 6 }}>
      {t("bonus")}
    </div>
  );
}

/** Marks a bonus mission: optional for its level, with its own reward when it has one. */
export function BonusBadge({ reward }: { reward?: number }) {
  const t = useTranslations("missionLinks");
  return (
    <div data-testid="mission-bonus-badge" style={{ marginTop: 6 }}>
      <span
        style={{
          display: "inline-block",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "2px 8px",
          borderRadius: 999,
          background: "hsl(var(--butter))",
          color: "hsl(var(--ink))",
          border: "1px solid hsl(var(--rule-warm) / 0.55)",
        }}
      >
        {t("bonusBadge")}
      </span>
      <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginLeft: 8 }}>
        {reward && reward > 0 ? t("bonusPays", { reward: reward.toLocaleString() }) : t("bonusOptional")}
      </span>
    </div>
  );
}

export function GetBoxLink({ url }: { url: string }) {
  const t = useTranslations("missionLinks");
  const external = /^https?:\/\//.test(url);
  return (
    <div
      data-testid="mission-get-box"
      style={{
        marginTop: 10,
        padding: "8px 10px",
        background: "hsl(var(--butter) / 0.15)",
        borderLeft: "2px solid hsl(var(--butter))",
        borderRadius: 4,
        fontSize: 13,
        display: "grid",
        gap: 4,
      }}
    >
      <span>{t("boxHint")}</span>
      <a
        href={url}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        style={{ fontWeight: 700, textDecoration: "underline" }}
      >
        {t("getBox")}
      </a>
    </div>
  );
}
