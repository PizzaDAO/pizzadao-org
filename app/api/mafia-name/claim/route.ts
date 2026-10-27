// app/api/mafia-name/claim/route.ts
// Records a member's claimed mafia name (plans/mafia-name-port.md, Phase 2) and
// returns the public id behind /made/[id].
//
// POST { name, topping?, filmId?, filmTitle?, tmdbMovieId?, origin?, originSig?, candidates?, portraitUrl? }
//   200 { id, public } | 400 invalid | 401 no session | 413 too large | 429 limited
//
// Every name gets a claim row, but only a name /api/namegen actually offered
// (originSig verifies) is `public`, i.e. gets a /made/[id] page. Typed, kept or
// Discord-nick names are stored privately, with no origin.
//
// Idempotent per member + name: the finale calls it on mount and again when the
// portrait (or a redraw) is ready, which only updates the same row.
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";
import { sanitizeDisplayName } from "@/app/lib/display-name";
import { recordActivationLater } from "@/app/lib/activation";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { verifyNameOrigin } from "@/app/lib/name-origin-sig";
import { MAFIA_FILMS } from "@/app/lib/mafia-films";
import { NAME_ORIGIN_KINDS } from "@/app/lib/name-origin";
import { newClaimId } from "@/app/lib/mafia-claim";

export const runtime = "nodejs";

/** A member can legitimately claim a handful of names; this only stops abuse. */
const MAX_CLAIMS_PER_MEMBER = 20;

const bodySchema = z.object({
  name: z.string().max(80),
  topping: z.string().trim().max(50).optional(),
  filmId: z.string().max(60).optional(),
  filmTitle: z.string().trim().max(120).optional(),
  tmdbMovieId: z.string().regex(/^\d{1,20}$/).optional(),
  origin: z
    .object({
      kind: z.enum(NAME_ORIGIN_KINDS),
      person: z.string().trim().min(1).max(80),
      film: z.string().trim().min(1).max(120),
    })
    .optional(),
  originSig: z.string().max(100).optional(),
  candidates: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  portraitUrl: z.string().max(500).optional(),
});

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "mafia-name-claim");
  if (limited) return limited;

  const session = await getSession();
  if (!session?.discordId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const discordId = session.discordId;

  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;
  const name = sanitizeDisplayName(body.name);
  if (!name) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const film = body.filmId ? MAFIA_FILMS.find((f) => f.id === body.filmId) : undefined;
  const filmTitle = film?.title ?? body.filmTitle ?? "";

  // The signature covers name + origin as namegen issued them (film = its
  // resolved title). Verify first, then prefer the catalog's own title.
  const verified = Boolean(body.origin && verifyNameOrigin(name, body.origin, body.originSig));
  const origin = verified && body.origin ? { ...body.origin, film: film?.title ?? body.origin.film } : null;

  // Only link a portrait that /api/mafia-portrait issued (the url is the key; a
  // cache hit hands the same url to a member with identical inputs).
  let portraitId: string | undefined;
  if (body.portraitUrl) {
    const portrait = await prisma.mafiaPortrait.findFirst({
      // Only a portrait this member drew (or a legacy row with no owner).
      where: { url: body.portraitUrl, OR: [{ discordId }, { discordId: null }] },
      select: { id: true },
    });
    portraitId = portrait?.id;
  }

  const fields = {
    topping: body.topping ?? "",
    filmId: film?.id ?? null,
    filmTitle,
    tmdbMovieId: body.tmdbMovieId ?? null,
    origin: origin ?? Prisma.DbNull,
    public: verified,
    candidates: body.candidates ?? [],
    ...(portraitId ? { portraitId } : {}),
  };

  const where = { discordId_name: { discordId, name } };
  let existing = await prisma.mafiaNameClaim.findUnique({ where, select: { id: true } });
  if (!existing) {
    if ((await prisma.mafiaNameClaim.count({ where: { discordId } })) >= MAX_CLAIMS_PER_MEMBER) {
      return NextResponse.json({ error: "Too many claims" }, { status: 429 });
    }
    try {
      existing = await prisma.mafiaNameClaim.create({
        data: { id: newClaimId(), discordId, name: name.slice(0, 80), ...fields },
        select: { id: true },
      });
    } catch (e) {
      // Lost a race on (discordId, name): fall through and update the winner.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      existing = await prisma.mafiaNameClaim.findUnique({ where, select: { id: true } });
      if (!existing) throw e;
    }
  } else {
    await prisma.mafiaNameClaim.update({ where, data: fields });
  }

  recordActivationLater("name_claimed", { discordId, code: "ok" });
  return NextResponse.json({ id: existing.id, public: verified });
}
