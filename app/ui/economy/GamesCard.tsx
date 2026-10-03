"use client";

// app/ui/economy/GamesCard.tsx
//
// Web versions of the Discord casino games (slots, roulette, blackjack).
// Same server logic and ledger as the slash commands: POST
// /api/economy/games/{slots,roulette,blackjack}. Rendered on /pep only when
// /api/economy/features says games are on (PEP_GAMES_ENABLED=1).

import React, { useCallback, useEffect, useState } from "react";
import { PepAmount } from "./PepIcon";
import { cardSurface, primaryButton, useCountdown } from "./CrimeCard";
import { input } from "../shared-styles";

type Tab = "slots" | "roulette" | "blackjack";

const SLOT_EMOJI: Record<string, string> = { pizza: "🍕", pepper: "🌶️", mushroom: "🍄", cheese: "🧀", tomato: "🍅" };
const SUIT: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
const card = (c: string) => (c === "??" ? "🂠" : `${c[0] === "T" ? "10" : c[0]}${SUIT[c[1]] ?? ""}`);

type BlackjackView = {
  id: string;
  bet: number;
  status: "ACTIVE" | "SETTLED";
  player: string[];
  dealer: string[];
  playerTotal: number;
  dealerTotal: number | null;
  outcome: string | null;
  payout: number | null;
  autoStood?: boolean;
};

const OUTCOME: Record<string, string> = {
  blackjack: "Blackjack! You win",
  win: "You win",
  dealer_bust: "Dealer busts. You win",
  push: "Push. Stake back:",
  lose: "Dealer wins.",
  bust: "Bust! Dealer wins.",
  dealer_blackjack: "Dealer has blackjack.",
};

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function GamesCard({ onResult }: { onResult?: () => void }) {
  const [tab, setTab] = useState<Tab>("slots");
  const [bet, setBet] = useState("10");
  const [space, setSpace] = useState("red");
  const [number, setNumber] = useState("17");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<React.ReactNode>(null);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [hand, setHand] = useState<BlackjackView | null>(null);
  const wait = useCountdown(readyAt);

  const loadHand = useCallback(async () => {
    try {
      const res = await fetch("/api/economy/games/blackjack");
      if (res.ok) setHand((await res.json()).game ?? null);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (tab === "blackjack") loadHand();
  }, [tab, loadHand]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const handle = (res: Response, data: Record<string, unknown>) => {
    if (res.status === 429 && typeof data.readyAt === "string") {
      setReadyAt(new Date(data.readyAt).getTime());
      return false;
    }
    if (!res.ok && res.status !== 409) throw new Error((data.error as string) || "Something went wrong");
    return true;
  };

  const betValue = Number(bet);

  const spinSlots = () =>
    run(async () => {
      const { res, data } = await post("/api/economy/games/slots", { bet: betValue });
      if (!handle(res, data)) return;
      const reels = (data.reels as string[]).map((r) => SLOT_EMOJI[r] ?? r).join(" ");
      setMessage(
        <span className="flex flex-wrap items-center gap-2">
          <span style={{ fontSize: 28 }}>{reels}</span>
          {(data.payout as number) > 0 ? (
            <span className="flex items-center gap-1">
              {data.multiplier as number}x: <PepAmount amount={data.payout as number} size={14} />
            </span>
          ) : (
            <span>No luck.</span>
          )}
        </span>,
      );
      onResult?.();
    });

  const spinRoulette = () =>
    run(async () => {
      const chosen = space === "number" ? number : space;
      const { res, data } = await post("/api/economy/games/roulette", { bet: betValue, space: chosen });
      if (!handle(res, data)) return;
      const dot = data.color === "red" ? "🔴" : data.color === "black" ? "⚫" : "🟢";
      setMessage(
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {dot} <strong>{data.landed as number}</strong>
          </span>
          {(data.payout as number) > 0 ? (
            <span className="flex items-center gap-1">
              You win <PepAmount amount={data.payout as number} size={14} />
            </span>
          ) : (
            <span>You lose.</span>
          )}
        </span>,
      );
      onResult?.();
    });

  const blackjack = (body: Record<string, unknown>) =>
    run(async () => {
      const { res, data } = await post("/api/economy/games/blackjack", body);
      if (!handle(res, data)) return;
      if (data.game) setHand(data.game as BlackjackView);
      onResult?.();
    });

  const tabs: Array<[Tab, string]> = [
    ["slots", "Slots"],
    ["roulette", "Roulette"],
    ["blackjack", "Blackjack"],
  ];
  const disabled = busy || wait > 0;
  const handLive = hand?.status === "ACTIVE";

  return (
    <div className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7" style={cardSurface}>
      <div className="relative flex items-start justify-between gap-4">
        <p className="overline text-tomato">§ ··· The back room</p>
        <span className="handwritten -rotate-[5deg]" style={{ fontSize: 14, color: "hsl(var(--foreground) / 0.55)" }}>
          house always wins
        </span>
      </div>
      <h2
        className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-[-0.02em] text-foreground"
        style={{ fontSize: "clamp(1.4rem, 3vw, 1.9rem)", lineHeight: 0.95 }}
      >
        Games
      </h2>

      <div className="relative mt-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            type="button"
            className="btn-pill"
            onClick={() => {
              setTab(id);
              setMessage(null);
              setError(null);
            }}
            style={{
              background: tab === id ? "hsl(var(--ink))" : "hsl(var(--secondary))",
              color: tab === id ? "hsl(var(--cream))" : "hsl(var(--secondary-foreground))",
              border: "1px solid hsl(var(--rule-warm) / 0.55)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative mt-4 grid gap-3">
        {!(tab === "blackjack" && handLive) && (
          <label className="grid gap-1">
            <span className="overline text-foreground/55">Bet (10 to 5,000)</span>
            <input type="number" min={10} step={1} value={bet} onChange={(e) => setBet(e.target.value)} style={input()} />
          </label>
        )}

        {tab === "roulette" && (
          <div className="flex flex-wrap gap-2">
            <select value={space} onChange={(e) => setSpace(e.target.value)} style={{ ...input(), flex: 1, minWidth: 120 }} aria-label="Bet on">
              <option value="red">Red (2x)</option>
              <option value="black">Black (2x)</option>
              <option value="even">Even (2x)</option>
              <option value="odd">Odd (2x)</option>
              <option value="number">A number (36x)</option>
            </select>
            {space === "number" && (
              <input
                type="number"
                min={0}
                max={36}
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                style={{ ...input(), width: 90 }}
                aria-label="Number"
              />
            )}
          </div>
        )}

        {tab === "blackjack" && hand && (
          <div style={{ padding: 12, borderRadius: 14, border: "1px solid hsl(var(--rule-warm) / 0.45)", background: "hsl(var(--background))" }}>
            <div>
              You: <strong>{hand.player.map(card).join(" ")}</strong> ({hand.playerTotal})
            </div>
            <div>
              Dealer: <strong>{hand.dealer.map(card).join(" ")}</strong>
              {hand.dealerTotal != null ? ` (${hand.dealerTotal})` : ""}
            </div>
            {hand.status === "SETTLED" && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {hand.autoStood ? "Timed out, auto-stood. " : ""}
                {OUTCOME[hand.outcome ?? ""] ?? "Settled."}
                {hand.payout ? <PepAmount amount={hand.payout} size={14} /> : null}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {tab === "slots" && (
            <button type="button" className="btn-pill-lg flex-1" disabled={disabled} onClick={spinSlots} style={primaryButton(disabled)}>
              {wait > 0 ? `Wait ${wait}s` : "Spin"}
            </button>
          )}
          {tab === "roulette" && (
            <button type="button" className="btn-pill-lg flex-1" disabled={disabled} onClick={spinRoulette} style={primaryButton(disabled)}>
              {wait > 0 ? `Wait ${wait}s` : "Spin the wheel"}
            </button>
          )}
          {tab === "blackjack" && !handLive && (
            <button
              type="button"
              className="btn-pill-lg flex-1"
              disabled={disabled}
              onClick={() => blackjack({ action: "start", bet: betValue })}
              style={primaryButton(disabled)}
            >
              {wait > 0 ? `Wait ${wait}s` : "Deal"}
            </button>
          )}
          {tab === "blackjack" && handLive && (
            <>
              <button
                type="button"
                className="btn-pill-lg flex-1"
                disabled={busy}
                onClick={() => blackjack({ action: "hit", gameId: hand!.id })}
                style={primaryButton(busy)}
              >
                Hit
              </button>
              <button
                type="button"
                className="btn-pill-lg flex-1"
                disabled={busy}
                onClick={() => blackjack({ action: "stand", gameId: hand!.id })}
                style={primaryButton(busy)}
              >
                Stand
              </button>
            </>
          )}
        </div>

        {error && (
          <p className="text-sm" role="alert" style={{ color: "hsl(var(--tomato))" }}>
            {error}
          </p>
        )}
        {message && tab !== "blackjack" && <div role="status">{message}</div>}
        <p className="ui text-[10px] uppercase tracking-[0.22em]" style={{ color: "hsl(var(--muted-foreground))" }}>
          Bets come from your wallet. Also on Discord: /slots, /roulette, /blackjack
        </p>
      </div>
    </div>
  );
}
