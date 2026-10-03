// app/api/discord/interactions/route.ts
//
// Discord HTTP Interactions endpoint for the $PEP slash commands that replace
// UnbelievaBoat (/balance, /work). Set this URL as the "Interactions Endpoint
// URL" of the PizzaDAO Discord application, then register the commands with
// scripts/discord/register-commands.mjs. See plans/unbelievaboat-replacement.md.
//
// Env: DISCORD_PUBLIC_KEY (hex, Developer Portal > General Information),
//      DISCORD_GUILD_ID, optional PEP_EMOJI (e.g. <:pepperoni:973304305979367444>).
import { NextResponse } from "next/server";
import { verifyDiscordRequest } from "@/app/lib/discord-interactions/verify";
import { handleInteraction, type Interaction } from "@/app/lib/discord-interactions/handle";
import { doWork } from "@/app/lib/pep-earn/work";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getWallet(discordId: string): Promise<number> {
  // Read-only: looking someone up must not create rows for them.
  const econ = await prisma.economy.findUnique({ where: { id: discordId }, select: { wallet: true } });
  return econ?.wallet ?? 0;
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
    const res = await handleInteraction(interaction, {
      guildId: process.env.DISCORD_GUILD_ID?.trim(),
      getWallet,
      doWork,
      currency: process.env.PEP_EMOJI?.trim() || "$PEP",
    });
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
