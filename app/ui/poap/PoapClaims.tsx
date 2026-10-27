"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { paperCard, pillInk, pillOutline, pillTomato } from "@/app/ui/shared/Editorial";
import type { PoapClaimItem } from "@/app/lib/poap-claims";

type State = { kind: "loading" } | { kind: "anon" } | { kind: "error" } | { kind: "ready"; items: PoapClaimItem[] };

function usePoapClaims() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/poap-claims", { cache: "no-store" });
      if (res.status === 401) return setState({ kind: "anon" });
      if (!res.ok) return setState({ kind: "error" });
      const json = (await res.json()) as { items: PoapClaimItem[] };
      setState({ kind: "ready", items: json.items });
    } catch {
      setState({ kind: "error" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { state, setState, load };
}

function useDay() {
  const locale = useLocale();
  return (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Dashboard card: only renders when the member has POAPs waiting to be claimed. */
export function PoapClaimsCard() {
  const t = useTranslations("poapClaims");
  const { state } = usePoapClaims();
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
      <Link href="/poaps" className={pillTomato}>{t("cardCta")}</Link>
    </section>
  );
}

/** Full list on /poaps: claimed + claimable calls. */
export function PoapClaimsList() {
  const t = useTranslations("poapClaims");
  const fmt = useDay();
  const { state, setState } = usePoapClaims();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function claim(item: PoapClaimItem) {
    const key = `${item.crewId}|${item.callDay}`;
    setBusy(key);
    setErr(null);
    try {
      const res = await fetch("/api/poap-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewId: item.crewId, callDay: item.callDay }),
      });
      const json = (await res.json().catch(() => ({}))) as { link?: string; error?: string };
      if (res.ok && json.link) {
        const link = json.link;
        setState((s) => s.kind === "ready"
          ? { kind: "ready", items: s.items.map((i) => i.crewId === item.crewId && i.callDay === item.callDay ? { ...i, status: "claimed", link } : i) }
          : s);
      } else {
        setErr(t(json.error === "none_left" ? "noneLeft" : "claimError"));
      }
    } catch {
      setErr(t("claimError"));
    } finally {
      setBusy(null);
    }
  }

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
          <Link href="/login?returnTo=/poaps" className={pillInk}>{t("login")}</Link>
        </div>
      )}
      {state.kind === "ready" && state.items.length === 0 && (
        <div className={`${paperCard} p-5 grid gap-3 justify-items-start`}>
          <p className="m-0">{t("empty")}</p>
          <Link href="/calls/how-to-attend" className={pillOutline}>{t("howTo")}</Link>
        </div>
      )}
      {state.kind === "ready" && state.items.length > 0 && (
        <ul className="grid gap-3 list-none p-0 m-0">
          {state.items.map((item) => {
            const key = `${item.crewId}|${item.callDay}`;
            return (
              <li key={key} className={`${paperCard} p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <p className="font-display text-base font-black m-0">{item.crewLabel}</p>
                  <p className="overline text-foreground/55 m-0" style={{ fontSize: 10 }}>{fmt(item.callDay)}</p>
                </div>
                {item.status === "claimable" && (
                  <button type="button" className={pillTomato} disabled={busy === key} onClick={() => claim(item)}>
                    {busy === key ? t("claiming") : t("claim")}
                  </button>
                )}
                {item.status === "claimed" && item.link && (
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className={pillInk}>{t("openLink")}</a>
                )}
                {item.status === "unavailable" && (
                  <span className="text-sm text-foreground/55">{t("unavailable")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {err && <p role="alert" className="text-destructive mt-3">{err}</p>}
    </section>
  );
}
