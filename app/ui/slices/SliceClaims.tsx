"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { paperCard, pillInk, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";
import type { SliceItem } from "@/app/lib/slices/claims";

type State = { kind: "loading" } | { kind: "anon" } | { kind: "error" } | { kind: "ready"; items: SliceItem[]; contractUrl: string | null };

const POLL_MS = 3000;
const POLL_MAX = 15; // ~45 seconds

function useSlices() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/slices", { cache: "no-store" });
      if (res.status === 401) return setState({ kind: "anon" });
      if (!res.ok) return setState({ kind: "error" });
      const json = (await res.json()) as { items: SliceItem[]; contractUrl: string | null };
      setState({ kind: "ready", items: json.items, contractUrl: json.contractUrl });
    } catch {
      setState({ kind: "error" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { state, load };
}

function useDay() {
  const locale = useLocale();
  return (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Dashboard card: only renders when the member has slices waiting to be claimed. */
export function SliceClaimsCard() {
  const t = useTranslations("slices");
  const { state } = useSlices();
  if (state.kind !== "ready") return null;
  const claimable = state.items.filter((i) => i.status === "claimable").length;
  if (claimable === 0) return null;
  return (
    <section className={`${paperCard} my-4 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3`} aria-label={t("cardAria")}>
      <div>
        <p className="overline text-tomato m-0">{t("overline")}</p>
        <p className="font-display text-lg font-black m-0">{t("cardTitle", { count: claimable })}</p>
        <p className="text-sm text-foreground/70 m-0">{t("cardBody")}</p>
      </div>
      <Link href="/slices" className={pillTomato}>{t("cardCta")}</Link>
    </section>
  );
}

/** Full list on /slices: claimable, in progress, minted, waiting for a wallet. */
export function SliceClaimsList() {
  const t = useTranslations("slices");
  const fmt = useDay();
  const { state, load } = useSlices();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const polls = useRef(0);

  const inFlight = state.kind === "ready" && state.items.some((i) => i.status === "queued" || i.status === "minting");
  useEffect(() => {
    if (!inFlight) { polls.current = 0; return; }
    const timer = setInterval(() => {
      if (++polls.current > POLL_MAX) return clearInterval(timer);
      void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, load]);

  async function claim(payload: { crewId: string; callDay: string } | { all: true }, key: string) {
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch("/api/slices/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) setErr(t("rateLimited"));
      else if (!res.ok) setErr(t("claimError"));
      else polls.current = 0;
      await load();
    } catch {
      setErr(t("claimError"));
    } finally {
      setBusy(null);
    }
  }

  const items = state.kind === "ready" ? state.items : [];
  const claimable = items.filter((i) => i.status === "claimable");
  const needsWallet = items.some((i) => i.status === "awaiting_wallet");
  const minted = items.filter((i) => i.status === "minted").length;

  return (
    <section className="mb-10" aria-label={t("listAria")}>
      <p className="overline text-tomato mb-2">{t("overline")}</p>
      <h2 className="font-display text-2xl font-black tracking-tight mt-0 mb-1">{t("title")}</h2>
      <p className="text-sm text-foreground/70 mt-0 mb-4">{t("intro")}</p>

      {state.kind === "loading" && <div className={`${paperCard} h-[88px] animate-pulse`} />}
      {state.kind === "error" && <p className="text-destructive">{t("loadError")}</p>}
      {state.kind === "anon" && (
        <div className={`${paperCard} p-5 grid gap-3 justify-items-start`}>
          <p className="m-0">{t("loginPrompt")}</p>
          <Link href="/login?returnTo=/slices" className={pillInk}>{t("login")}</Link>
        </div>
      )}
      {state.kind === "ready" && items.length === 0 && (
        <div className={`${paperCard} p-5 grid gap-3 justify-items-start`}>
          <p className="m-0">{t("empty")}</p>
          <Link href="/calls/how-to-attend" className={pillOutline}>{t("howTo")}</Link>
        </div>
      )}

      {state.kind === "ready" && items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <p className="m-0 text-sm text-foreground/70">{t("summary", { minted, total: items.length })}</p>
            {claimable.length > 1 && (
              <button type="button" className={pillTomato} disabled={busy !== null} onClick={() => claim({ all: true }, "all")}>
                {busy === "all" ? t("claiming") : t("claimAll", { count: claimable.length })}
              </button>
            )}
            {state.contractUrl && (
              <a href={state.contractUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">{t("contract")}</a>
            )}
          </div>
          {needsWallet && (
            <div className={`${paperCard} p-4 mb-4 flex flex-wrap items-center justify-between gap-3`}>
              <p className="m-0 text-sm">{t("walletNeeded")}</p>
              <Link href="/me/wallets" className={pillOutline}>{t("linkWallet")}</Link>
            </div>
          )}
          <ul className="grid gap-3 list-none p-0 m-0">
            {items.map((item) => {
              const key = `${item.crewId}|${item.callDay}`;
              return (
                <li key={key} className={`${paperCard} p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3`}>
                  <div className="flex items-center gap-3 min-w-0">
                    {item.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt="" width={56} height={56} loading="lazy" className="rounded-lg flex-shrink-0 border border-[hsl(var(--rule-warm)/0.65)]" />
                    )}
                    <div className="min-w-0">
                      <p className="font-display text-base font-black m-0">{item.crewLabel}</p>
                      <p className="overline text-foreground/55 m-0" style={{ fontSize: 10 }}>{fmt(item.callDay)}</p>
                    </div>
                  </div>
                  {item.status === "claimable" && (
                    <button type="button" className={pillTomato} disabled={busy !== null} onClick={() => claim({ crewId: item.crewId, callDay: item.callDay }, key)}>
                      {busy === key ? t("claiming") : t("claim")}
                    </button>
                  )}
                  {(item.status === "queued" || item.status === "minting") && (
                    <span className="text-sm text-foreground/70" role="status">{t("baking")}</span>
                  )}
                  {item.status === "awaiting_wallet" && (
                    <span className="text-sm text-foreground/70">{t("awaitingWallet")}</span>
                  )}
                  {item.status === "failed" && (
                    <span className="text-sm text-foreground/70">{t("failed")}</span>
                  )}
                  {item.status === "minted" && (
                    <span className="flex items-center gap-3 text-sm">
                      <span className="text-foreground/70">{t("minted")}</span>
                      {item.txUrl && <a href={item.txUrl} target="_blank" rel="noopener noreferrer" className="underline">{t("viewOnBasescan")}</a>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {err && <p role="alert" className="text-destructive mt-3">{err}</p>}
    </section>
  );
}
