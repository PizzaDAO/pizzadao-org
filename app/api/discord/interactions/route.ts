// app/api/discord/interactions/route.ts
//
// Discord HTTP Interactions endpoint for the $PEP slash commands that replace
// UnbelievaBoat (see PEP_COMMANDS in app/lib/discord-interactions/commands.ts).
// Set this URL as the "Interactions Endpoint URL" of the PizzaDAO Discord
// application, then register the commands with
// scripts/discord/register-commands.mjs. See plans/unbelievaboat-replacement.md.
//
// Env: DISCORD_PUBLIC_KEY (hex, Developer Portal > General Information),
//      DISCORD_GUILD_ID, DISCORD_BOT_TOKEN (guild role names for
//      /collect-income), optional PEP_EMOJI (e.g. <:pepperoni:973304305979367444>).
// Flags: PEP_ROB_ENABLED=1 (/rob, /peace), PEP_GAMES_ENABLED=1 (games).
import { NextResponse } from "next/server";
import { verifyDiscordRequest } from "@/app/lib/discord-interactions/verify";
import { handleInteraction, type HandlerDeps, type Interaction } from "@/app/lib/discord-interactions/handle";
import { getGuildRoles } from "@/app/lib/discord-interactions/guild-roles";
import { doWork } from "@/app/lib/pep-earn/work";
import { collectIncome, resolveRoleIncome, roleIncomeConfig } from "@/app/lib/pep-earn/income";
import { attemptRob, getPeaceMode, robEnabled, setPeaceMode } from "@/app/lib/pep-earn/rob";
import { gamesEnabled } from "@/app/lib/pep-games/config";
import { blackjackAction, startBlackjack } from "@/app/lib/pep-games/blackjack";
import { parseRouletteSpace, playRoulette } from "@/app/lib/pep-games/roulette";
import { playSlots } from "@/app/lib/pep-games/slots";
import { getLeaderboard, transfer } from "@/app/lib/economy";
import { buyItem, getShopItems } from "@/app/lib/shop";
import { fetchMemberByDiscordId } from "@/app/lib/sheets/member-repository";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getWallet(discordId: string): Promise<number> {
  // Read-only: looking someone up must not create rows for them.
  const econ = await prisma.economy.findUnique({ where: { id: discordId }, select: { wallet: true } });
  return econ?.wallet ?? 0;
}

/** Discord wants an answer within 3s: names come from the (cached) members sheet, or not at all. */
async function leaderboardWithNames() {
  const rows = await getLeaderboard(10);
  const names = await Promise.race([
    Promise.all(rows.map((r) => fetchMemberByDiscordId(r.userId).then((m) => m?.name || null).catch(() => null))),
    new Promise<null[]>((resolve) => setTimeout(() => resolve(rows.map(() => null)), 1200)),
  ]);
  return rows.map((r, idx) => ({ ...r, name: names[idx] }));
}

function deps(guildId: string | undefined): HandlerDeps {
  return {
    guildId,
    currency: process.env.PEP_EMOJI?.trim() || "$PEP",
    getWallet,
    doWork,
    collectIncome: async (discordId, roleIds) => {
      const { resolved, unresolved } = resolveRoleIncome(roleIncomeConfig(), guildId ? await getGuildRoles(guildId) : null);
      if (unresolved.length) console.warn("[collect-income] unresolved roles:", unresolved.join(", "));
      return { ...(await collectIncome(discordId, roleIds, resolved)), unresolved };
    },
    pay: (from, to, amount) => transfer(from, to, amount),
    leaderboard: leaderboardWithNames,
    robEnabled,
    rob: (robber, victim, ctx) => attemptRob(robber, victim, ctx),
    getPeace: getPeaceMode,
    setPeace: (id, enable) => setPeaceMode(id, enable),
    gamesEnabled,
    startBlackjack: (id, bet) => startBlackjack(id, bet, { source: "discord" }),
    blackjackAction: (id, gameId, action) => blackjackAction(id, gameId, action),
    roulette: (id, bet, space) => playRoulette(id, bet, parseRouletteSpace(space)),
    slots: (id, bet) => playSlots(id, bet),
    shopItems: getShopItems,
    buy: (id, itemId, qty) => buyItem(id, itemId, qty),
  };
}

export async function POST(req: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY?.trim();
  if (!publicKey) return NextResponse.json({ error: "Interactions not configured" }, { status: 503 });

  const rawBody = await req.text();
  const ok = verifyDiscordRequest({
    publicKeyHex: publicKey,
    signatureHex: req.headers.get("x-signature-ed25519"),
    timestamp: req.headers.get("x-signature-timestamp"),
    rawBody,
  });
  if (!ok) return NextResponse.json({ error: "invalid request signature" }, { status: 401 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  try {
    const res = await handleInteraction(interaction, deps(process.env.DISCORD_GUILD_ID?.trim()));
    return NextResponse.json(res);
  } catch (err) {
    console.error("[discord/interactions] handler failed:", err);
    // Still a valid interaction response so the user sees something.
    return NextResponse.json({
      type: 4,
      data: { content: "Something went wrong. Please try again.", flags: 64, allowed_mentions: { parse: [] } },
    });
  }
}
