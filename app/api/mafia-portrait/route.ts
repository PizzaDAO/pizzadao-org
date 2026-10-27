// app/api/mafia-portrait/route.ts
// AI portrait for the onboarding finale (plans/mafia-name-port.md, Phase 1).
//
// POST { name, topping?, turtles?, crews?, variant }
//   200 { url, cached, remaining? }
//   400 invalid input | 429 member limit (session) or IP limit (anonymous)
//   503 { fallback: true }: disabled, global cap, provider failure
//
// A session means the member path (5/day per member). Without one the caller is
// the public /get-your-mafia-name page: 3/day per IP, and no turtles/crews (an
// anonymous visitor has picked none). Both paths sit under the same global cap.
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
  type RateLimitResult,
  getClientIp,
  checkKeyedRateLimit,
  isUpstashConfigured,
  rateLimitResponse,
} from "@/app/lib/rate-limit";
import { activationActor, recordActivationLater } from "@/app/lib/activation";
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
  // Anonymous browser id, for the funnel only (the public page has no session).
  actor: z.string().max(80).optional(),
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

  // A valid session always takes the member path, so signing out is the only
  // way onto the IP path (which has the smaller allowance).
  const session = await getSession();
  const discordId = session?.discordId || undefined;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { variant } = parsed.data;
  const actor = activationActor(parsed.data.actor);
  const topping = parsed.data.topping ?? "";
  // Anonymous callers get no turtles/crews: the same name then shares one cache
  // entry (and one free hit) with a member who has picked none.
  const turtles = canonicalTurtles(discordId ? parsed.data.turtles : undefined);
  const crews = canonicalCrews(discordId ? parsed.data.crews : undefined);
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

  let own: RateLimitResult;
  if (discordId) {
    own = await checkKeyedRateLimit("mafia-portrait-member", discordId);
  } else {
    // Without an IP every visitor would share one bucket; refuse instead.
    const ip = getClientIp(req.headers);
    if (ip === "unknown") return fallback("capacity");
    own = await checkKeyedRateLimit("mafia-portrait-ip", ip, undefined, { failClosed: true });
  }
  if (!own.success) return rateLimitResponse(own);

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
    recordActivationLater("portrait_failed", { discordId, actor, code: reason });
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
        discordId: discordId ?? null,
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

  recordActivationLater("portrait_generated", { discordId, actor, code: "ok" });
  return NextResponse.json({
    url: drawn.url,
    cached: false,
    remaining: own.remaining,
  });
}
