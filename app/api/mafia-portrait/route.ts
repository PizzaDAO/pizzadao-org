// app/api/mafia-portrait/route.ts
// AI portrait for the onboarding finale (plans/mafia-name-port.md, Phase 1).
//
// POST { name, topping?, turtles?, crews?, variant }
//   200 { url, cached, remaining? }
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
import {
  RATE_LIMITS,
  checkKeyedRateLimit,
  isUpstashConfigured,
  rateLimitResponse,
} from "@/app/lib/rate-limit";
import { recordActivationLater } from "@/app/lib/activation";
import { PortraitUnavailable, generatePortrait, portraitModelId } from "@/app/lib/mafia-portrait/generate";
import { canonicalCrews, canonicalTurtles, portraitCacheKey } from "@/app/lib/mafia-portrait/prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_DAILY_CAP = 300;

const bodySchema = z.object({
  name: z.string().max(60),
  // Stored as metadata only; the prompt does not use it.
  topping: z.string().trim().max(50).optional(),
  // Unknown turtles / crews are dropped by canonicalTurtles / canonicalCrews.
  turtles: z.array(z.string().max(40)).max(12).optional(),
  crews: z.array(z.string().max(60)).max(30).optional(),
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
  const { variant } = parsed.data;
  const topping = parsed.data.topping ?? "";
  const turtles = canonicalTurtles(parsed.data.turtles);
  const crews = canonicalCrews(parsed.data.crews);
  const name = sanitizeDisplayName(parsed.data.name);
  if (!name) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const cacheKey = portraitCacheKey({ name, turtles, crews, variant });

  // Cache hits are free: they skip the limits and the provider.
  const hit = await prisma.mafiaPortrait.findUnique({ where: { cacheKey } });
  if (hit) return NextResponse.json({ url: hit.url, cached: true });

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

  const member = await checkKeyedRateLimit("mafia-portrait-member", discordId);
  if (!member.success) return rateLimitResponse(member);

  let drawn: { url: string; model: string };
  try {
    drawn = await generatePortrait({ name, turtles, crews });
  } catch (e) {
    const cause = e instanceof PortraitUnavailable ? e.cause : e;
    const info = cause as { name?: string; message?: string; statusCode?: number; status?: number; code?: string } | undefined;
    console.error("[mafia-portrait] generation failed", {
      reason: info?.name,
      message: String(info?.message ?? "").slice(0, 200),
      status: info?.statusCode ?? info?.status,
      code: info?.code,
    });
    const reason =
      info?.name === "TimeoutError" || info?.name === "AbortError"
        ? "timeout"
        : e instanceof PortraitUnavailable && e.message.includes("upload")
          ? "upload"
          : "provider";
    recordActivationLater("portrait_failed", { discordId, code: reason });
    return fallback("provider");
  }

  try {
    await prisma.mafiaPortrait.create({
      data: {
        cacheKey,
        name: name.slice(0, 80),
        topping,
        filmKey: "",
        variant,
        animal: "",
        model: drawn.model || portraitModelId(),
        url: drawn.url,
        discordId,
      },
    });
  } catch (e) {
    // Lost a race on the unique key: serve the winner's portrait.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.mafiaPortrait.findUnique({ where: { cacheKey } });
      if (winner) return NextResponse.json({ url: winner.url, cached: true });
    }
    console.error("[mafia-portrait] could not store portrait row");
    // The image exists; still show it to this member.
  }

  recordActivationLater("portrait_generated", { discordId, code: "ok" });
  return NextResponse.json({
    url: drawn.url,
    cached: false,
    remaining: member.remaining,
  });
}
