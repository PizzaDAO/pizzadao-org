"use client";

// app/ui/economy/DailyPepCard.tsx
//
// "Collect daily PEP" on the website. GET/POST /api/pep/collect-income run the same
// collectIncome as the /collect-income slash command, so a collect here blocks the
// command until the next period (and vice versa).

import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cardSurface, primaryButton, useCountdown } from "./CrimeCard";

type Status = {
  totalAvailable: number;
  nextReadyAt: string | null;
  earnRoles: Array<{ name: string; amount: number; intervalHours?: number }>;
};

const RETRY_MS = 15_000;
const MAX_RETRIES = 8;

type Phase = "loading" | "ready" | "unavailable";

export function formatWait(seconds: number): { key: "timeHM" | "timeM" | "timeS"; h: number; m: number } {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return { key: "timeHM", h, m };
  if (m > 0) return { key: "timeM", h, m };
  return { key: "timeS", h, m };
}

export function DailyPepCard({ onCollected }: { onCollected?: (balance: number) => void }) {
  const t = useTranslations("collectPep");
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const wait = useCountdown(readyAt);

  const applyStatus = useCallback((s: Status) => {
    setStatus(s);
    setReadyAt(s.nextReadyAt ? new Date(s.nextReadyAt).getTime() : null);
    setPhase("ready");
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pep/collect-income", { cache: "no-store" });
      if (!res.ok) {
        setPhase("unavailable");
        return;
      }
      applyStatus(await res.json());
    } catch {
      setPhase("unavailable");
    }
  }, [applyStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  // When a countdown reaches zero, the next period has opened: refresh. If the server still says
  // not ready (clock skew), retry every ~15s, at most MAX_RETRIES times.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!readyAt || wait !== 0 || Date.now() < readyAt || retry >= MAX_RETRIES) return;
    const timer = setTimeout(
      () => {
        setRetry((n) => n + 1);
        void load();
      },
      retry === 0 ? 0 : RETRY_MS,
    );
    return () => clearTimeout(timer);
  }, [readyAt, wait, load, retry]);
  useEffect(() => setRetry(0), [readyAt]);

  const collect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pep/collect-income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setMessage({ kind: "error", text: t("tooMany") });
        return;
      }
      if (!res.ok) {
        setMessage({ kind: "error", text: res.status === 503 ? t("unavailable") : t("error") });
        return;
      }
      setStatus((s) => ({ earnRoles: s?.earnRoles ?? [], totalAvailable: 0, nextReadyAt: data.nextReadyAt ?? null }));
      setReadyAt(data.nextReadyAt ? new Date(data.nextReadyAt).getTime() : null);
      if (data.total > 0) {
        setMessage({
          kind: "ok",
          text: t("success", { amount: data.total.toLocaleString(), balance: Number(data.balance).toLocaleString() }),
        });
        onCollected?.(data.balance);
      } else {
        void load();
      }
    } catch {
      setMessage({ kind: "error", text: t("error") });
    } finally {
      setBusy(false);
    }
  };

  if (phase === "loading") {
    return <div className="mb-6 h-[120px] rounded-[24px] border bg-muted" style={cardSurface} aria-busy="true" />;
  }

  const w = formatWait(wait);
  const canCollect = !!status && status.totalAvailable > 0;
  const roles = status?.earnRoles ?? [];
  const first = roles[0];

  let body: React.ReactNode;
  if (phase === "unavailable") {
    body = <p className="m-0 text-sm text-muted-foreground">{t("unavailable")}</p>;
  } else if (canCollect) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          className="font-[family-name:var(--font-display)] text-xl font-black tracking-tight text-foreground"
          data-testid="daily-pep-available"
        >
          {t("available", { amount: status!.totalAvailable.toLocaleString() })}
        </div>
        <button
          type="button"
          onClick={collect}
          disabled={busy}
          className="btn-pill-lg"
          style={{ ...primaryButton(busy), minHeight: 44, minWidth: 140 }}
        >
          {busy ? t("collecting") : t("collect")}
        </button>
      </div>
    );
  } else if (readyAt) {
    body = (
      <p className="m-0 text-base font-semibold text-foreground" data-testid="daily-pep-wait">
        {t("nextIn", { time: t(w.key, { h: w.h, m: w.m }) })}
      </p>
    );
  } else {
    body = (
      <p className="m-0 text-sm text-muted-foreground" data-testid="daily-pep-noroles">
        {t("noRoles")}{" "}
        {first
          ? roles.length === 1
            ? (first.intervalHours ?? 24) === 24
              ? t("getRole", { role: first.name, amount: first.amount })
              : t("getRoleEvery", { role: first.name, amount: first.amount, hours: first.intervalHours ?? 24 })
            : t("joinRoles", { roles: roles.map((r) => `${r.name} (${r.amount})`).join(", ") })
          : ""}
      </p>
    );
  }

  return (
    <section
      className="paper-soft relative mb-6 overflow-hidden rounded-[24px] border p-5 md:p-6"
      style={cardSurface}
      aria-label={t("title")}
      data-testid="daily-pep-card"
    >
      <p className="overline m-0 text-tomato">§ ··· {t("overline")}</p>
      <h2
        className="font-[family-name:var(--font-display)] mt-2 mb-3 flex items-center gap-2 font-black tracking-[-0.02em] text-foreground"
        style={{ fontSize: "clamp(1.4rem, 3vw, 1.9rem)", lineHeight: 0.95 }}
      >
        {t("title")}
      </h2>
      {body}
      {message && (
        <p
          role="status"
          className="mt-3 mb-0 text-sm font-semibold"
          style={{ color: message.kind === "ok" ? "hsl(var(--foreground))" : "hsl(var(--tomato))" }}
        >
          {message.text}
        </p>
      )}
      <p className="mt-3 mb-0 text-xs text-muted-foreground">{t("alsoDiscord")}</p>
    </section>
  );
}
