"use client";

// L5.3 "Own a Rare Pizza Box": where to get a box, shown on the mission card.

import { useTranslations } from "next-intl";

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
