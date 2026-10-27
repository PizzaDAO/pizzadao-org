// app/api/mafia-portrait/route.ts
// AI portrait for the onboarding finale (plans/mafia-name-port.md, Phase 1).
//
// POST { name, topping, filmId?, filmTitle?, variant }
//   200 { url, animal, cached, remaining? }
//   400 invalid input | 401 no session | 429 member limit
//   503 { fallback: true }: disabled, global cap, provider failure
//
// The finale never blocks on this route: any non-200 just keeps the topping seal.
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";
import { sanitizeDisplayName } from "@/app/lib/display-name";
import { MAFIA_FILMS } from "@/app/lib/mafia-films";
import {
  RATE_LIMITS,
  checkKeyedRateLimit,
  isUpstashConfigured,
  rateLimitResponse,
} from "@/app/lib/rate-limit";
import { recordActivationLater } from "@/app/lib/activation";
import { generatePortrait, portraitModelId } from "@/app/lib/mafia-portrait/generate";
import { portraitCacheKey } from "@/app/lib/mafia-portrait/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_DAILY_CAP = 300;

const bodySchema = z.object({
  name: z.string().max(60),
  topping: z.string().trim().min(1).max(50),
  filmId: z.string().max(60).optional(),
  filmTitle: z.string().max(120).optional(),
  variant: z.number().int().min(0).max(4),
});

const fallback = (reason: string) => NextResponse.json({ fallback: true, reason }, { status: 503 });

function dailyCap(): number {
  const n = Number.parseInt(process.env.MAFIA_PORTRAIT_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

export async function POST(req: Request) {
  if (process.env.MAFIA_PORTRAIT_ENABLED !== "1" || !process.env.OPENAI_API_KEY) {
    return fallback("disabled");
  }

  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const discordId = session.discordId;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { topping, filmId, filmTitle, variant } = parsed.data;
  const name = sanitizeDisplayName(parsed.data.name);
  if (!name) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (filmId && !MAFIA_FILMS.some((f) => f.id === filmId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const filmKey = (filmId || filmTitle?.trim() || "").slice(0, 120);
  const cacheKey = portraitCacheKey({ name, topping, filmKey, variant });

  // Cache hits are free: they skip the limits and the provider.
  const hit = await prisma.mafiaPortrait.findUnique({ where: { cacheKey } });
  if (hit) return NextResponse.json({ url: hit.url, animal: hit.animal, cached: true });

  const member = await checkKeyedRateLimit("mafia-portrait-member", discordId);
  if (!member.success) return rateLimitResponse(member);

  // The global spend cap fails CLOSED: if Redis is down (or, on Vercel, not
  // configured so counters would be per instance) we refuse rather than risk
  // unbounded OpenAI spend.
  if (process.env.VERCEL && !isUpstashConfigured()) return fallback("capacity");
  const global = await checkKeyedRateLimit(
    "mafia-portrait-global",
    "all",
    { ...RATE_LIMITS["mafia-portrait-global"], limit: dailyCap() },
    { failClosed: true },
  );
  if (!global.success) return fallback("capacity");

  let drawn: { url: string; animal: string; model: string };
  try {
    drawn = await generatePortrait({ name, topping, filmId });
  } catch (e) {
    console.error("[mafia-portrait] generation failed", e instanceof Error ? e.name : "unknown");
    recordActivationLater("portrait_failed", { discordId, code: "provider" });
    return fallback("provider");
  }

  try {
    await prisma.mafiaPortrait.create({
      data: {
        cacheKey,
        name: name.slice(0, 80),
        topping,
        filmKey,
        variant,
        animal: drawn.animal,
        model: drawn.model || portraitModelId(),
        url: drawn.url,
        discordId,
      },
    });
  } catch (e) {
    // Lost a race on the unique key: serve the winner's portrait.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.mafiaPortrait.findUnique({ where: { cacheKey } });
      if (winner) return NextResponse.json({ url: winner.url, animal: winner.animal, cached: true });
    }
    console.error("[mafia-portrait] could not store portrait row");
    // The image exists; still show it to this member.
  }

  recordActivationLater("portrait_generated", { discordId, code: "ok" });
  return NextResponse.json({
    url: drawn.url,
    animal: drawn.animal,
    cached: false,
    remaining: member.remaining,
  });
}
