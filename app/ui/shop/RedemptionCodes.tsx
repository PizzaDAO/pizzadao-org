"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type MyCodes = {
  enabled: boolean;
  siteUrl: string;
  active: Array<{ code: string; acquiredAt: string }>;
  redeemed: Array<{ code: string; redeemedAt: string }>;
};

/**
 * Proof of Pizza codes card (plans/proof-of-pizza-codes.md). Renders only for a member who holds codes (or
 * has used one), so everyone else sees nothing. Codes are secrets: this card is only ever on the signed-in
 * member's own pages, never on a public profile.
 */
export function RedemptionCodes({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useTranslations("proofOfPizza");
  const locale = useLocale();
  const [data, setData] = useState<MyCodes | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await fetch("/api/proof-of-pizza/my-codes", { cache: "no-store" });
        if (res.ok && !stopped) setData((await res.json()) as MyCodes);
      } catch {
        // Quiet: the card just does not show.
      }
    })();
    return () => {
      stopped = true;
    };
  }, [refreshKey]);

  const copy = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000);
    } catch {
      // Clipboard blocked: the code is still on screen to read.
    }
  }, []);

  if (!data || !data.enabled || (data.active.length === 0 && data.redeemed.length === 0)) return null;

  const site = data.siteUrl || "https://proofof.pizza";
  const host = site.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });

  return (
    <section
      data-testid="pep-redemption-codes"
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--rule-warm) / 0.55)", boxShadow: "var(--shadow-soft)" }}
    >
      <h2
        className="font-[family-name:var(--font-display)] m-0 font-black tracking-[-0.02em] text-foreground"
        style={{ fontSize: "clamp(1.2rem, 2.6vw, 1.6rem)", lineHeight: 1 }}
      >
        {t("title")}
      </h2>

      {data.active.length > 0 && (
        <>
          <p className="mt-2 mb-0 text-sm text-muted-foreground">{t("intro")}</p>
          <ol className="mt-3 mb-0 grid gap-1 pl-5 text-sm text-foreground">
            <li>
              {t.rich("step1", {
                host,
                site: (chunks) => (
                  <a href={site} target="_blank" rel="noopener noreferrer" className="text-tomato underline">
                    {chunks}
                  </a>
                ),
              })}
            </li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          <ul className="mt-4 mb-0 grid list-none gap-2 p-0">
            {data.active.map((c) => (
              <li
                key={c.code}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[hsl(var(--rule-warm)/0.45)] bg-background px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-2xl font-black tracking-[0.3em] text-foreground" data-testid="redemption-code">
                    {c.code}
                  </div>
                  <div className="text-xs text-muted-foreground">{t("acquiredOn", { date: day(c.acquiredAt) })}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copy(c.code)}
                  aria-label={t("copyLabel", { code: c.code })}
                  className="rounded-full border px-3 py-1 text-xs font-semibold text-foreground"
                  style={{ borderColor: "hsl(var(--rule-warm) / 0.55)", background: "transparent", cursor: "pointer" }}
                >
                  {copied === c.code ? t("copied") : t("copy")}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 mb-0 text-xs text-muted-foreground">{t("keepSecret")}</p>
        </>
      )}

      {data.redeemed.length > 0 && (
        <div className="mt-4">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/55">{t("redeemedHeading")}</p>
          <ul className="mt-2 mb-0 grid list-none gap-1 p-0 opacity-60">
            {data.redeemed.map((c) => (
              <li key={c.code} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-mono tracking-[0.25em] line-through">{c.code}</span>
                <span className="text-xs text-muted-foreground">{t("redeemedOn", { date: day(c.redeemedAt) })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
