"use client";

// The "follow on X" mission (verifier x_linked) can only check that an X account is linked: the
// app never reads who a member follows. This note says so, shows the link state, and gives
// tap-friendly links that open the X app on a phone (x.com links are universal links).

import { useTranslations } from "next-intl";

export const X_FOLLOW_HANDLES = ["RarePizzas", "Pizza_DAO"] as const;

export type XLinkState = "linked" | "notLinked" | "unchecked";

/** Link state from the mission card: approved = linked; a failed check = not linked; else unknown. */
export function xLinkState(completed: boolean, checkStatus?: string): XLinkState {
  if (completed) return "linked";
  if (checkStatus === "pass") return "linked";
  if (checkStatus === "fail") return "notLinked";
  return "unchecked";
}

export function XFollowNote({ state, profileEditHref }: { state: XLinkState; profileEditHref?: string | null }) {
  const t = useTranslations("missionLinks.x");
  return (
    <div
      data-testid="x-follow-note"
      data-state={state}
      style={{
        marginTop: 10,
        padding: "10px 12px",
        fontSize: 13,
        lineHeight: 1.5,
        borderLeft: "2px solid hsl(var(--butter))",
        background: "hsl(var(--butter) / 0.15)",
        borderRadius: 4,
      }}
    >
      <strong>{t("title")}</strong>
      <p style={{ margin: "4px 0 0" }} data-testid="x-link-state">
        {t(state)}{" "}
        {state !== "linked" && profileEditHref && (
          <a href={profileEditHref} style={{ fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
            {t("connectLink")}
          </a>
        )}
      </p>
      <p style={{ margin: "6px 0 0" }}>{t("honor")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
        {X_FOLLOW_HANDLES.map((handle) => (
          <a
            key={handle}
            href={`https://x.com/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
              padding: "0 14px",
              borderRadius: 999,
              border: "1px solid hsl(var(--foreground) / 0.3)",
              fontWeight: 600,
              textDecoration: "none",
              color: "hsl(var(--foreground))",
            }}
          >
            {t("open", { handle })}
          </a>
        ))}
      </div>
      <p style={{ margin: "8px 0 0", color: "hsl(var(--muted-foreground))" }}>{t("mobile")}</p>
    </div>
  );
}
