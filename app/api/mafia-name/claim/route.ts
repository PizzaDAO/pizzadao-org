// app/api/mafia-name/claim/route.ts
// Records a member's claimed mafia name (plans/mafia-name-port.md, Phase 2) and
// returns the public id behind /made/[id].
//
// POST { name, topping?, filmId?, filmTitle?, tmdbMovieId?, origin?, candidates?, portraitUrl? }
//   200 { id } | 400 invalid | 401 no session | 429 too many claims
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
  candidates: z.array(z.string().trim().min(1).max(80)).max(60).optional(),
  portraitUrl: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.discordId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const discordId = session.discordId;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const body = parsed.data;
  const name = sanitizeDisplayName(body.name);
  if (!name) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const film = body.filmId ? MAFIA_FILMS.find((f) => f.id === body.filmId) : undefined;
  const filmTitle = film?.title ?? body.filmTitle ?? "";

  // Only link a portrait that /api/mafia-portrait issued (the url is the key; a
  // cache hit hands the same url to a member with identical inputs).
  let portraitId: string | undefined;
  if (body.portraitUrl) {
    const portrait = await prisma.mafiaPortrait.findFirst({
      where: { url: body.portraitUrl },
      select: { id: true },
    });
    portraitId = portrait?.id;
  }

  const fields = {
    topping: body.topping ?? "",
    filmId: film?.id ?? null,
    filmTitle,
    tmdbMovieId: body.tmdbMovieId ?? null,
    origin: body.origin ?? Prisma.DbNull,
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
  return NextResponse.json({ id: existing.id });
}
